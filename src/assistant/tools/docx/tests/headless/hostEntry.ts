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
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { applyDocumentEdits, LiveEditor } from '../../syncfusionDocumentOps';
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

function tableBlockIndex(tableId: string): number {
  const found = parsed().sections[0].blocks.findIndex((block: any) =>
    JSON.stringify(block).includes(`[[table=${tableId}]]`)
  );
  if (found < 0) throw new Error(`no marker for table "${tableId}"`);
  return found;
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

  /** Laid-out pages. Zero means layout never ran, which is the jsdom failure. */
  pageCount: (): number => (live().documentHelper as any).pages?.length ?? 0,

  /** Content controls the engine REGISTERED during layout, not JSON hits. */
  contentControlCount: (): number =>
    ((live().documentHelper as any).contentControlCollection ?? []).length,

  contentControlTags: (): string[] =>
    Array.from((live().documentHelper as any).contentControlCollection ?? []).map(
      (control: any) =>
        String(
          control?.contentControlProperties?.tag ??
            control?.contentControlProperties?.title ??
            ''
        )
    ),

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
    const blockIndex = tableBlockIndex(tableId);
    const result: any = applyDocumentEdits(live() as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: `0;${blockIndex};0;0;0`,
          rows: 'copy',
          keepRows: moving
        } as any,
        {
          op: 'delete_row',
          anchor: `0;${blockIndex};${moving[0]};0;0`,
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

  groups: (): any[] =>
    listRevisionGroups(live() as any).map((view: any) => ({
      changeSetId: view.changeSetId,
      group: view.group,
      untagged: view.untagged
    })),

  chipCount: (): number =>
    listRevisionGroups(live() as any).reduce(
      (total: number, view: any) => total + view.items.length,
      0
    ),

  /** Accept (`true`) or reject (`false`) every live group as one undo. */
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
