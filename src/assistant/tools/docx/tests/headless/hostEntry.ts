// In-page bridge to the real DocumentEditor used by the headless specs.
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
import { installRevisionHighlightRendering } from '../../../../../elements/components/DocxEditor/useDocxEditor';
import { colorForRevisionAuthor } from '../../../../../elements/components/DocxEditor/history/authorColors';
import { versionPreviewHarness } from './versionPreviewHarness';
import { historyReviewHarness } from './historyReviewHarness';

declare const __SYNCFUSION_LICENSE_KEY__: string;

if (__SYNCFUSION_LICENSE_KEY__) registerLicense(__SYNCFUSION_LICENSE_KEY__);

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

let editor: DocumentEditor | null = null;
let attached: AttachedBindings | null = null;

const live = (): DocumentEditor => {
  if (!editor) throw new Error('no document is open - call open() first');
  return editor;
};

const parsed = (): any => JSON.parse(live().serialize());
const indexOf = (): any => scanBindings(parsed());

// Headless Chrome can withhold animation frames, so keep the timer fallback.
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

function tableBlockOf(tableId: string): any {
  const path = indexOf().tables.get(tableId)?.tablePath;
  if (!path) throw new Error(`no bound table "${tableId}"`);
  let node: any = parsed();
  for (const segment of path) node = node?.[segment as any];
  if (!Array.isArray(node?.rows))
    throw new Error(`the path for "${tableId}" does not reach a table`);
  return node;
}

function tableBlockAtAnchor(anchor: string): any {
  const [section, block] = anchor.split(';').map(Number);
  const topLevel = parsed()?.sections?.[section]?.blocks?.[block];
  const find = (node: any): any => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node.rows)) return node;
    for (const child of node.blocks ?? []) {
      const table = find(child);
      if (table) return table;
    }
    return undefined;
  };
  const table = find(topLevel);
  if (!table) throw new Error(`no table at "${anchor}"`);
  return table;
}

function documentFormulas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, occurrences] of indexOf().formulas) {
    const expression = (occurrences as any[])[0]?.def?.expression;
    if (typeof expression === 'string') out.set(name, expression);
  }
  return out;
}

function editResultSummary(result: any) {
  return {
    outcomes: result.results.map((entry: any) =>
      entry.ok ? 'ok' : String(entry.error)
    ),
    messages: result.results.map((entry: any) => String(entry.message ?? '')),
    status: String(result.changeSet?.status ?? ''),
    warnings: (result.warnings ?? []).map((entry: any) => String(entry))
  };
}

function inventoryEntryHolding(find: string) {
  const entry = api
    .inventory()
    .find((candidate) => candidate.text.includes(find));
  if (!entry)
    throw new Error(`no inventory entry holds ${JSON.stringify(find)}`);
  return entry;
}

const api = {
  ...versionPreviewHarness,
  ...historyReviewHarness,
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

  pageCount: (): number => (live().documentHelper as any).pages?.length ?? 0,

  contentControlCount: (): number =>
    ((live().documentHelper as any).contentControlCollection ?? []).length,

  serializedTags: (): string[] => {
    const tags: string[] = [];
    JSON.stringify(parsed(), (key, value) => {
      if (key === 'contentControlProperties' && value?.tag)
        tags.push(String(value.tag));
      return value;
    });
    return tags;
  },

  setTrackChanges(on: boolean): boolean {
    live().enableTrackChanges = on;
    return live().enableTrackChanges;
  },

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
    const entry = inventoryEntryHolding(find);
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
      ...editResultSummary(result)
    };
  },

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
    const entry = inventoryEntryHolding(find);
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
      ...editResultSummary(result)
    };
  },

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

  async verifyHistoryRenderer(): Promise<boolean> {
    const instance = live() as any;
    installRevisionHighlightRendering(instance, colorForRevisionAuthor);
    const renderer = instance.documentHelper.render;
    const check = renderer.checkRevisionType;
    instance.showRevisions = true;
    instance.resize();
    await frame();
    await frame();
    return renderer.checkRevisionType === check;
  },

  async observeHistoryEdit(text: string): Promise<string[]> {
    const snapshots: string[] = [];
    const instance = live();
    const changed = () => snapshots.push(instance.serialize());
    instance.addEventListener('contentChange', changed);
    try {
      instance.selection.moveToDocumentEnd();
      instance.editor.insertText(text);
      await frame();
      return snapshots;
    } finally {
      instance.removeEventListener('contentChange', changed);
    }
  },

  formulaValues: (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const occurrence of indexOf().occurrences)
      if (occurrence.def.kind === 'formula')
        out[occurrence.name] = occurrence.text;
    return out;
  },

  tableIds: (): string[] => Array.from(indexOf().tables.keys()).map(String),

  tableAnchorContaining(text: string): string {
    const cell = api
      .inventory()
      .find(
        (entry) => entry.kind === 'table_cell' && entry.text.includes(text)
      );
    if (!cell)
      throw new Error(`no table cell contains ${JSON.stringify(text)}`);
    return cell.anchor.split(';').slice(0, 2).join(';');
  },

  tableRowTextsAt(anchor: string): string[] {
    return tableBlockAtAnchor(anchor).rows.map((row: any) => nodeText(row));
  },

  tableColumnCountAt(anchor: string): number {
    return Math.max(
      0,
      ...tableBlockAtAnchor(anchor).rows.map((row: any) =>
        Array.isArray(row?.cells) ? row.cells.length : 0
      )
    );
  },

  columnWidthsAt(anchor: string): number[] {
    const instance: any = live();
    instance.selection.select(`${anchor};0;0;0;0`, `${anchor};0;0;0;0`);
    const rows: any[] =
      instance.selection?.start?.paragraph?.associatedCell?.ownerTable
        ?.childWidgets ?? [];
    const cells: any[] =
      [...rows].sort(
        (left, right) =>
          (right.childWidgets?.length ?? 0) - (left.childWidgets?.length ?? 0)
      )[0]?.childWidgets ?? [];
    return cells.map((cell) =>
      Number(
        cell?.cellFormat?.preferredWidth || cell?.cellFormat?.cellWidth || 0
      )
    );
  },

  rowShadingAt(anchor: string): Array<string | null> {
    return tableBlockAtAnchor(anchor).rows.map((row: any) => {
      const colour = row?.cells?.[0]?.cellFormat?.shading?.backgroundColor;
      return !colour || colour === 'empty' ? null : String(colour);
    });
  },

  cellParagraphStyleAt(
    anchor: string,
    rowIndex: number,
    columnIndex: number
  ): string | null {
    const cell =
      tableBlockAtAnchor(anchor)?.rows?.[rowIndex]?.cells?.[columnIndex];
    const paragraph = cell?.blocks?.[0];
    const format = paragraph?.paragraphFormat ?? paragraph?.pf;
    return format?.styleName ?? format?.stn ?? null;
  },

  traces: (): any[] => (globalThis as any).__featheryDocumentEditTraceLog ?? [],

  tableRowIds: (tableId: string): string[] =>
    (indexOf().tables.get(tableId)?.rows ?? []).map((row: any) =>
      String(row.rowId)
    ),

  tableRowTexts: (tableId: string): string[] =>
    tableBlockOf(tableId).rows.map((row: any) => nodeText(row)),

  tableColumnCount: (tableId: string): number =>
    Math.max(
      0,
      ...tableBlockOf(tableId).rows.map((row: any) =>
        Array.isArray(row?.cells) ? row.cells.length : 0
      )
    ),

  // A split is duplicate_table followed by complementary delete_row edits.
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
    const staying = structure.rows
      .filter((row: any) => row.role === 'item' && !moving.includes(row.index))
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
          resultRef: '@copy'
        } as any,
        {
          op: 'delete_row',
          anchor: '@copy',
          rows: staying
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

  tableAnchor(tableId: string): string {
    return tableBlockAnchor(tableId);
  },

  applyEdits(
    edits: any[],
    changeSetId?: string
  ): {
    outcomes: string[];
    messages: string[];
    groups: number;
    revisions: number;
    warnings: string[];
    executionTrace?: unknown;
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
      warnings: (result.warnings ?? []).map((entry: any) => String(entry)),
      executionTrace: result.executionTrace
    };
  },

  applyEditsWithNativeFailure(
    edits: any[],
    changeSetId: string,
    method: string,
    failAt = 1,
    failure: 'return' | 'throw' = 'return'
  ): {
    outcomes: string[];
    groups: number;
    status: string;
  } {
    const instance: any = live();
    const module = instance.editorModule;
    const original = module?.[method];
    if (typeof original !== 'function')
      throw new Error(`no native editor method ${method}`);
    let calls = 0;
    module[method] = function (...args: any[]) {
      calls += 1;
      if (calls === failAt) {
        if (failure === 'throw') throw new Error(`forced ${method} failure`);
        return undefined;
      }
      return original.apply(this, args);
    };
    try {
      const result: any = applyDocumentEdits(
        instance as unknown as LiveEditor,
        { edits, changeSetId }
      );
      return {
        outcomes: result.results.map((entry: any) =>
          entry.ok ? 'ok' : String(entry.error)
        ),
        groups: listRevisionGroups(instance as unknown as LiveEditor).length,
        status: String(result.changeSet?.status ?? '')
      };
    } finally {
      module[method] = original;
    }
  },

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
    return editResultSummary(result);
  },

  rowShading(tableId: string): Array<string | null> {
    const block: any = tableBlockOf(tableId);
    const rows: any[] = block?.rows ?? [];
    return rows.map((row: any) => {
      const cell = row?.cells?.[0];
      const colour = cell?.cellFormat?.shading?.backgroundColor;
      return !colour || colour === 'empty' ? null : String(colour);
    });
  },

  columnWidths(tableId: string): number[] {
    const anchor = tableBlockAnchor(tableId);
    const instance: any = live();
    instance.selection.select(`${anchor};0;0;0;0`, `${anchor};0;0;0;0`);
    const table =
      instance.selection?.start?.paragraph?.associatedCell?.ownerTable;
    const rows: any[] = table?.childWidgets ?? [];
    const cells: any[] =
      [...rows].sort(
        (left, right) =>
          (right.childWidgets?.length ?? 0) - (left.childWidgets?.length ?? 0)
      )[0]?.childWidgets ?? [];
    return cells.map((cell) =>
      Number(
        cell?.cellFormat?.preferredWidth || cell?.cellFormat?.cellWidth || 0
      )
    );
  },

  cellShading(tableId: string, row: number, column: number): string | null {
    const cell = tableBlockOf(tableId)?.rows?.[row]?.cells?.[column];
    const colour = cell?.cellFormat?.shading?.backgroundColor;
    return !colour || colour === 'empty' ? null : String(colour);
  },

  dismissTrialNotice(): number {
    // The test host owns only the editor; every other body child is trial UI.
    const host = document.getElementById('fm-editor');
    const doomed = Array.from(document.body.children).filter(
      (node) => node !== host && !host?.contains(node)
    );
    for (const node of doomed) node.remove();
    return doomed.length;
  },

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
