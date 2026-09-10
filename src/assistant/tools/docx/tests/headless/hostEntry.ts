/**
 * The headless lane's in-page engine surface.
 *
 * This file is bundled at test time and loaded by `host.html` inside a headless
 * Chromium. It mounts the REAL `DocumentEditor` and re-exposes the SAME engine
 * entry points the jsdom specs drive - `applyDocumentEdits`,
 * `deriveTableStructure`, `attachBindings`, `scanBindings`,
 * `listRevisionGroups`, `resolveLiveRevisionGroupsAsOneUndo` - on `window`, so a
 * puppeteer spec measures the engine rather than a re-implementation of it.
 *
 * Nothing here decides anything. Every predicate, threshold and expectation
 * lives in the specs; this is transport plus the two things jsdom cannot do:
 * lay out, and therefore register content controls and walk laid-out widgets.
 */
import { registerLicense } from '@syncfusion/ej2-base';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import {
  applyDocumentEdits,
  getDocumentInventory,
  LiveEditor
} from '../../syncfusionDocumentOps';
import { deriveTableStructure } from '../../tableStructure';
import {
  attachBindings,
  AttachedBindings
} from '../../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { scanBindings } from '../../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../../utils/documentEditorPrimitives';

// Declared the way `src/utils/init.ts` declares `__PACKAGE_VERSION__`: the
// bundler substitutes it (see buildHostBundle's DefinePlugin), so it needs a
// type here and nothing else.
declare const __SYNCFUSION_LICENSE_KEY__: string;

// A trial build throws a modal over the document, which makes every screenshot
// evidence of a dialog rather than of the split. Register when a key is
// available; `dismissTrialNotice` below is the fallback for when one is not.
if (__SYNCFUSION_LICENSE_KEY__) registerLicense(__SYNCFUSION_LICENSE_KEY__);

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

export interface HeadlessRevision {
  revisionID: string;
  revisionType: string;
  author: string;
  rangeLength: number;
}

let editor: DocumentEditor | null = null;
let attached: AttachedBindings | null = null;

const live = (): DocumentEditor => {
  if (!editor) throw new Error('no document is open - call open() first');
  return editor;
};

const parsed = (): any => JSON.parse(live().serialize());
const indexOf = (): any => scanBindings(parsed());

/**
 * One settle tick. Races `requestAnimationFrame` against a timer on purpose:
 * a headless, never-composited page can withhold animation frames entirely, and
 * a settle that waits only on rAF would hang forever instead of failing.
 */
const frame = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });

/** Every `text` run under a node, concatenated in document order. */
function nodeText(node: any): string {
  let out = '';
  JSON.stringify(node, (key, value) => {
    if (key === 'text' && typeof value === 'string') out += value;
    return value;
  });
  return out;
}

function tableBlockAnchor(tableId: string): string {
  const path = indexOf().tables.get(tableId)?.markerPath as
    | Array<string | number>
    | undefined;
  const sectionKey = path?.indexOf('sections') ?? -1;
  const blockKey = path?.indexOf('blocks', sectionKey + 2) ?? -1;
  const section = sectionKey >= 0 ? Number(path?.[sectionKey + 1]) : NaN;
  const block = blockKey >= 0 ? Number(path?.[blockKey + 1]) : NaN;
  if (!Number.isInteger(section) || !Number.isInteger(block))
    throw new Error(`no body marker for table "${tableId}"`);
  return `${section};${block}`;
}

/** The table node for a bound id, reached by the scanner's own indexed path. */
function tableBlockOf(tableId: string): any {
  const path = indexOf().tables.get(tableId)?.tablePath;
  if (!path) throw new Error(`no bound table "${tableId}"`);
  let node: any = parsed();
  for (const segment of path) node = node?.[segment as any];
  if (!Array.isArray(node?.rows))
    throw new Error(`the path for "${tableId}" does not reach a table`);
  return node;
}

function documentFormulas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, occurrences] of indexOf().formulas) {
    const expression = (occurrences as any[])[0]?.def?.expression;
    if (typeof expression === 'string') out.set(name, expression);
  }
  return out;
}

const api = {
  /** Mount, open, and settle layout. Resolves only once pages exist. */
  async open(sfdt: string, headerRowsHint = 1): Promise<void> {
    void headerRowsHint;
    api.close();
    (globalThis as any).__featheryDocumentEditTraceLog = [];
    (globalThis as any).__featheryDocumentEditTrace = (entry: unknown) =>
      (globalThis as any).__featheryDocumentEditTraceLog.push(
        JSON.parse(JSON.stringify(entry))
      );
    const host = document.createElement('div');
    host.id = 'fm-editor';
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    const instance = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableImageResizer: true,
      enableSearch: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    instance.appendTo(host);
    instance.open(sfdt);
    editor = instance;
    await frame();
    await frame();
    attached = attachBindings(instance as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    await frame();
  },

  close(): void {
    try {
      attached?.dispose();
    } finally {
      attached = null;
      const element = editor?.element;
      editor?.destroy();
      element?.remove();
      editor = null;
    }
  },

  reconcileBindings(): void {
    attached?.controller.flush();
  },

  /** Laid-out pages. Zero means layout never ran, which is the jsdom failure. */
  pageCount: (): number => (live().documentHelper as any).pages?.length ?? 0,

  /** Content controls the engine REGISTERED during layout, not JSON hits. */
  contentControlCount: (): number =>
    ((live().documentHelper as any).contentControlCollection ?? []).length,

  // TAG ONLY, never `title`. The scanner reads `tag` and nothing else
  // (sfdtAdapter), and `title` is a display label the editor TRUNCATES - 23 of
  // this document's 79 controls have a title that is a clipped copy of their
  // tag before any op runs. Falling back to it here was a way to read a stale
  // or clipped identity and call the result a tag.
  contentControlTags: (): string[] =>
    Array.from(
      (live().documentHelper as any).contentControlCollection ?? []
    ).map((control: any) =>
      String(control?.contentControlProperties?.tag ?? '')
    ),

  /** Every serialized control as the pair (tag, title), for identity checks. */
  serializedControls: (): Array<{ tag: string; title: string }> => {
    const out: Array<{ tag: string; title: string }> = [];
    JSON.stringify(parsed(), (key, value) => {
      if (key === 'contentControlProperties' && value?.tag)
        out.push({ tag: String(value.tag), title: String(value.title ?? '') });
      return value;
    });
    return out;
  },

  /** Tags as the SERIALIZED document carries them, for teardown comparison. */
  serializedTags: (): string[] => {
    const tags: string[] = [];
    JSON.stringify(parsed(), (key, value) => {
      if (key === 'contentControlProperties' && value?.tag)
        tags.push(String(value.tag));
      return value;
    });
    return tags;
  },

  trackChanges: (): boolean => live().enableTrackChanges,

  setTrackChanges(on: boolean): boolean {
    live().enableTrackChanges = on;
    return live().enableTrackChanges;
  },

  /**
   * The full inventory the assistant reads before editing, as
   * `{anchor, kind, text}` - the exact projection the tool schema makes the
   * model confirm an anchor with, laid out by the real engine.
   */
  inventory: (): { anchor: string; kind: string; text: string }[] => {
    const result: any = getDocumentInventory(live() as unknown as LiveEditor, {
      scope: 'full'
    });
    return (result.inventory ?? []).map((entry: any) => ({
      anchor: String(entry.anchor),
      kind: String(entry.kind),
      text: String(entry.text)
    }));
  },

  /**
   * One tracked `replace_text` aimed at whatever the INVENTORY says holds the
   * text - never at a hand-written anchor and never at a live search result.
   * That is the assistant's real route, and the only thing that makes a
   * text-box edit indistinguishable from a body edit at this layer.
   */
  replaceIndexed(
    find: string,
    replace: string,
    changeSetId: string
  ): {
    anchor: string;
    kind: string;
    outcomes: string[];
    messages: string[];
    status: string;
  } {
    const entry = api
      .inventory()
      .find((candidate) => candidate.text.includes(find));
    if (!entry)
      throw new Error(`no inventory entry holds ${JSON.stringify(find)}`);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      changeSetId,
      edits: [
        {
          op: 'replace_text',
          anchor: entry.anchor,
          find,
          replace,
          expect: entry.text
        } as any
      ]
    });
    return {
      anchor: entry.anchor,
      kind: entry.kind,
      outcomes: result.results.map((one: any) =>
        one.ok ? 'ok' : String(one.error)
      ),
      messages: result.results.map((one: any) => String(one.message ?? '')),
      status: String(result.changeSet?.status ?? '')
    };
  },

  /**
   * One `set_char_format` aimed at whatever the INVENTORY says holds the text -
   * the assistant's real route for "change the heading color to red", so the
   * colour word reaches the engine exactly as the model sends it.
   */
  formatIndexed(
    find: string,
    fontColor: string,
    changeSetId: string
  ): {
    anchor: string;
    kind: string;
    outcomes: string[];
    messages: string[];
    status: string;
  } {
    const entry = api
      .inventory()
      .find((candidate) => candidate.text.includes(find));
    if (!entry)
      throw new Error(`no inventory entry holds ${JSON.stringify(find)}`);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      changeSetId,
      edits: [
        {
          op: 'set_char_format',
          anchor: entry.anchor,
          fontColor,
          expect: entry.text
        } as any
      ]
    });
    return {
      anchor: entry.anchor,
      kind: entry.kind,
      outcomes: result.results.map((one: any) =>
        one.ok ? 'ok' : String(one.error)
      ),
      messages: result.results.map((one: any) => String(one.message ?? '')),
      status: String(result.changeSet?.status ?? '')
    };
  },

  /**
   * The colour the LAID-OUT document resolves for the range holding `find`,
   * read back through the public selection rather than out of the serialized
   * bytes - the closest this layer gets to what a human sees on the page.
   */
  resolvedFontColor(find: string): string {
    const entry = api
      .inventory()
      .find((candidate) => candidate.text.includes(find));
    if (!entry)
      throw new Error(`no inventory entry holds ${JSON.stringify(find)}`);
    const instance = live();
    instance.selection.select(
      `${entry.anchor};0`,
      `${entry.anchor};${entry.text.length}`
    );
    return String((instance.selection as any).characterFormat?.fontColor ?? '');
  },

  serialize: (): string => live().serialize(),

  serializeLength: (): number => live().serialize().length,

  revisions: (): HeadlessRevision[] => {
    const instance = live();
    return Array.from({ length: instance.revisions.length }, (_, index) => {
      const revision: any = instance.revisions.get(index);
      let rangeLength = -1;
      try {
        rangeLength = (revision.getRange() ?? []).length;
      } catch {
        rangeLength = -1;
      }
      return {
        revisionID: String(revision?.revisionID ?? ''),
        revisionType: String(revision?.revisionType ?? ''),
        author: String(revision?.author ?? ''),
        rangeLength
      };
    });
  },

  /** Each document-level formula's rendered text, by name. */
  formulaValues: (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const occurrence of indexOf().occurrences)
      if (occurrence.def.kind === 'formula')
        out[occurrence.name] = occurrence.text;
    return out;
  },

  formulaExpressions: (): Record<string, string> =>
    Object.fromEntries(documentFormulas()),

  tableIds: (): string[] => Array.from(indexOf().tables.keys()).map(String),

  traces: (): any[] => (globalThis as any).__featheryDocumentEditTraceLog ?? [],

  /** Bound row identities in document order, used to catch stale or duplicated controls. */
  tableRowIds: (tableId: string): string[] =>
    (indexOf().tables.get(tableId)?.rows ?? []).map((row: any) =>
      String(row.rowId)
    ),

  /** The roles `deriveTableStructure` assigns, row by row. */
  tableRoles: (tableId: string, headerRows: number): string[] =>
    deriveTableStructure({
      tableBlock: tableBlockOf(tableId),
      headerRows,
      tableId,
      documentFormulas: documentFormulas()
    }).rows.map((row: any) => row.role),

  /** Row texts of a bound table, so a spec can name a row by its content. */
  tableRowTexts: (tableId: string): string[] =>
    tableBlockOf(tableId).rows.map((row: any) => nodeText(row)),

  /**
   * The composition the assistant issues for a split: no split op exists.
   * `moving` is every item row at or below `splitAtRow`, exactly as the jsdom
   * specs compose it.
   */
  splitTable(
    tableId: string,
    headerRows: number,
    splitAtRow: number
  ): { outcomes: string[]; messages: string[]; moving: number[] } {
    const structure = deriveTableStructure({
      tableBlock: tableBlockOf(tableId),
      headerRows,
      tableId,
      documentFormulas: documentFormulas()
    });
    const moving = structure.rows
      .filter((row: any) => row.role === 'item' && row.index >= splitAtRow)
      .map((row: any) => row.index);
    if (!moving.length)
      throw new Error(`no item rows at or below ${splitAtRow} in "${tableId}"`);
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: `${tableAnchor};0;0;0`,
          rows: 'copy',
          keepRows: moving
        } as any,
        {
          op: 'delete_row',
          anchor: `${tableAnchor};${moving[0]};0;0`,
          rows: moving
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      moving
    };
  },

  /** The table's own anchor ("section;block"), the way the model names a whole table. */
  tableAnchor(tableId: string): string {
    return tableBlockAnchor(tableId);
  },

  /** Any raw edits array, exactly as the model would send it; outcomes plus group count. */
  applyEdits(
    edits: any[],
    changeSetId?: string
  ): {
    outcomes: string[];
    messages: string[];
    groups: number;
    revisions: number;
    warnings: string[];
  } {
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits,
      ...(changeSetId ? { changeSetId } : {})
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      groups: listRevisionGroups(live() as unknown as LiveEditor).length,
      revisions: (live() as any).revisions?.length ?? 0,
      warnings: (result.warnings ?? []).map((entry: any) => String(entry))
    };
  },

  /** The model's native split_table naming specific rows (they need not be adjacent). */
  nativeSplitRows(
    tableId: string,
    rows: number[]
  ): {
    outcomes: string[];
    messages: string[];
    ops: string[];
    warnings: string[];
  } {
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'split_table',
          anchor: `${tableAnchor};${rows[0]};0;0`,
          rows
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      ops: result.results.map((entry: any) => String(entry.op ?? '')),
      warnings: (result.warnings ?? []).map((entry: any) => String(entry))
    };
  },

  /** The hand-composed split of specific rows: duplicate with keepRows, then delete them. */
  composedSplitRows(
    tableId: string,
    rows: number[]
  ): { outcomes: string[]; messages: string[]; warnings: string[] } {
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: `${tableAnchor};0;0;0`,
          rows: 'copy',
          keepRows: rows
        } as any,
        {
          op: 'delete_row',
          anchor: `${tableAnchor};${rows[0]};0;0`,
          rows
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      warnings: (result.warnings ?? []).map((entry: any) => String(entry))
    };
  },

  /** A standalone tracked delete_row of the given item rows, one change set. */
  deleteRows(
    tableId: string,
    rows: number[]
  ): { outcomes: string[]; messages: string[]; warnings: string[] } {
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'delete_row',
          anchor: `${tableAnchor};${rows[0]};0;0`,
          rows
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      warnings: (result.warnings ?? []).map((entry: any) => String(entry))
    };
  },

  /** Background colour of the first cell of every row of the table, in order. */
  rowShading(tableId: string): Array<string | null> {
    const block: any = tableBlockOf(tableId);
    const rows: any[] = block?.rows ?? [];
    return rows.map((row: any) => {
      const cell = row?.cells?.[0];
      const colour = cell?.cellFormat?.shading?.backgroundColor;
      return !colour || colour === 'empty' ? null : String(colour);
    });
  },

  /**
   * One editor undo, then a settle tick, then the three numbers that say where
   * the document now stands. `serialized` is returned so a spec can compare
   * against its own pristine capture without a second round trip.
   */
  async undoOnce(): Promise<{
    ok: boolean;
    error: string;
    len: number;
    controls: number;
    revisions: number;
    serialized: string;
  }> {
    let ok = true;
    let error = '';
    try {
      live().editorHistory.undo();
    } catch (thrown) {
      ok = false;
      error = String(thrown);
    }
    await frame();
    const serialized = live().serialize();
    return {
      ok,
      error,
      len: serialized.length,
      controls: api.contentControlCount(),
      revisions: live().revisions.length,
      serialized
    };
  },

  /**
   * Take the trial licence furniture out of the page before a screenshot.
   *
   * Without a licence key the engine injects a modal dialog and a banner over
   * the document, and a shot of those proves nothing about the split. This
   * removes only that furniture; it touches no editor state, so a shot after it
   * is the same laid-out document a licensed build would show.
   */
  dismissTrialNotice(): number {
    // EVERY body child except the editor, rather than a class list. The trial
    // furniture is a banner AND a modal AND its overlay, each injected under
    // its own generated classes, and a selector list missed them - measured, a
    // shot taken after one still showed the dialog. This host page has exactly
    // one thing in it that matters, so naming what to KEEP is the reliable
    // direction.
    const host = document.getElementById('fm-editor');
    const doomed = Array.from(document.body.children).filter(
      (node) => node !== host && !host?.contains(node)
    );
    for (const node of doomed) node.remove();
    return doomed.length;
  },

  /**
   * Scroll the laid-out document to the first occurrence of some text, so a
   * screenshot shows the rows under test rather than page one.
   *
   * Driven through the engine's own Search rather than a scrollTop guess: the
   * page a widget lands on is not knowable from outside layout.
   */
  async focus(text: string): Promise<boolean> {
    try {
      const search: any = (live() as any).search;
      search.findAll(text);
      if (!search.searchResults?.length) return false;
      search.searchResults.index = 0;
      await frame();
      return true;
    } catch {
      return false;
    }
  },

  /**
   * The NATIVE op, one edit, no composition by the caller.
   *
   * `splitTable` above issues the two primitives by hand, which is what the
   * assistant had to do while a bound split was refused. This issues what the
   * captain's assistant actually sends - a single `split_table` - so the lane
   * measures the engine's own desugaring rather than a spec's imitation of it.
   * No `targetAnchor`: placement is engine-owned for a split.
   */
  nativeSplitTable(
    tableId: string,
    splitAtRow: number
  ): {
    outcomes: string[];
    messages: string[];
    ops: string[];
    warnings: string[];
  } {
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'split_table',
          anchor: `${tableAnchor};${splitAtRow};0;0`,
          splitAtRow
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? '')),
      ops: result.results.map((entry: any) => String(entry.op ?? '')),
      // What the change set said about itself. The assistant paraphrased one of
      // these to the captain as "a background template-row warning", and a
      // paraphrase is not a code anybody can act on.
      warnings: (result.warnings ?? []).map((entry: any) => String(entry))
    };
  },

  snapshot: (): {
    len: number;
    controls: number;
    revisions: number;
    serialized: string;
  } => {
    const serialized = live().serialize();
    return {
      len: serialized.length,
      controls: (serialized.match(/contentControlProperties/g) || []).length,
      revisions: live().revisions.length,
      serialized
    };
  },

  /** One tracked delete_row of a bound row, through applyDocumentEdits. */
  deleteRow(
    tableId: string,
    row: number
  ): { outcomes: string[]; messages: string[] } {
    const tableAnchor = tableBlockAnchor(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      changeSetId: 'undo-attribution',
      edits: [
        {
          op: 'delete_row',
          anchor: `${tableAnchor};${row};0;0`,
          rows: [row]
        } as any
      ]
    });
    return {
      outcomes: result.results.map((entry: any) =>
        entry.ok ? 'ok' : String(entry.error)
      ),
      messages: result.results.map((entry: any) => String(entry.message ?? ''))
    };
  },

  groups: (): any[] =>
    listRevisionGroups(live() as any).map((view: any) => ({
      changeSetId: view.changeSetId,
      group: view.group,
      untagged: view.untagged,
      derivedChanges: view.derivedChanges
    })),

  groupItems: (): any[] =>
    listRevisionGroups(live() as any).map((view: any) => ({
      changeSetId: view.changeSetId,
      group: view.group,
      items: view.items.map((item: any) => ({
        revisionType: item.revisionType,
        text: item.text,
        beforeText: item.beforeText
      }))
    })),

  chipCount: (): number =>
    listRevisionGroups(live() as any).reduce(
      (total: number, view: any) => total + view.items.length,
      0
    ),

  /** Accept (`true`) or reject (`false`) every live group as one undo. */
  /** Resolve only the groups one change set created, as one undo. */
  async resolveGroupsOf(changeSetId: string, accept: boolean): Promise<number> {
    const groups = api
      .groups()
      .filter((group: any) => group.changeSetId === changeSetId);
    const attempts = resolveLiveRevisionGroupsAsOneUndo(
      live() as any,
      groups,
      accept
    );
    await frame();
    return typeof attempts === 'number' ? attempts : -1;
  },

  async resolveGroups(accept: boolean): Promise<number> {
    const attempts = resolveLiveRevisionGroupsAsOneUndo(
      live() as any,
      api.groups(),
      accept
    );
    await frame();
    return typeof attempts === 'number' ? attempts : -1;
  }
};

(window as any).fmHeadless = api;
(window as any).fmHeadlessReady = true;
