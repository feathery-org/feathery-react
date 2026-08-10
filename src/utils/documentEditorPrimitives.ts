// Syncfusion document-editor primitives shared by the host editor and the
// lazily loaded assistant engine. Keep this module independent of assistant
// code so rendering a DOCX field does not pull the full edit engine into the
// host bundle.

export interface LiveEditor {
  serialize(): string;
  enableLayout?: boolean;
  enableTrackChanges: boolean;
  currentUser: string;
  selection: {
    select(start: string, end: string): void;
    text: string;
    startOffset: string;
    endOffset: string;
    characterFormat: any;
    paragraphFormat: any;
    isEmpty?: boolean;
    [key: string]: any;
  };
  editor: {
    insertText(text: string): void;
    delete(): void;
    [key: string]: any;
  };
  // eslint-disable-next-line no-use-before-define
  revisions?: LiveRevisionCollection;
  documentEditorSettings?: {
    revisionSettings?: { customData?: string | null; [key: string]: any };
    [key: string]: any;
  };
  editorHistory?: { undo?(): void; redo?(): void; [key: string]: any };
  search?: any;
  [key: string]: any;
}

export interface LiveRevision {
  revisionType?: string;
  revisionID?: string;
  customData?: string | null;
  accept?(): void;
  reject?(): void;
  handleAcceptReject?(isAccept: boolean, isGroupAcceptOrReject: boolean): void;
  select?(): void;
  [key: string]: any;
}

interface LiveRevisionCollection {
  length?: number;
  changes?: LiveRevision[];
  get?(index: number): LiveRevision;
  acceptAll?(): void;
  rejectAll?(): void;
  [key: string]: any;
}

export interface BorderWrite {
  type: string;
  style: string;
  width?: number;
  color?: string;
}

export interface AppearanceWrite {
  shading?: string | null;
  verticalAlignment?: 'Top' | 'Center' | 'Bottom';
  borders?: BorderWrite[];
}

type TableWidthType = 'Auto' | 'Percent' | 'Point';
type TableAlignment = 'Left' | 'Center' | 'Right';

/** Table-level geometry shared by automatic composition and copy_table_format. */
export interface TableLayoutFacts {
  preferredWidth: number;
  preferredWidthType: TableWidthType;
  leftIndent: number;
  tableAlignment: TableAlignment;
  allowAutoFit: boolean;
  /** One preferred width per logical column, all expressed in the same type. */
  columnWidths?: number[];
  columnWidthType?: TableWidthType;
}

/**
 * Non-visual SDK format values copied with a sibling table. Geometry and
 * appearance stay in their existing normalized facts so their equality and
 * border-topology rules remain single-sourced.
 */
export interface TablePropertyFacts {
  cellSpacing: number;
  leftMargin: number | null;
  rightMargin: number | null;
  topMargin: number | null;
  bottomMargin: number | null;
  bidi: boolean;
  styleName?: string;
  title?: string;
  description?: string;
  horizontalPositionAbs?: string;
  horizontalPosition?: number;
}

export interface RowPropertyFacts {
  allowBreakAcrossPages: boolean;
  height: number;
  heightType: string;
  gridBefore: number;
  gridBeforeWidth: number;
  gridBeforeWidthType: TableWidthType;
  gridAfter: number;
  gridAfterWidth: number;
  gridAfterWidthType: TableWidthType;
  leftMargin: number | null;
  rightMargin: number | null;
  topMargin: number | null;
  bottomMargin: number | null;
  leftIndent: number;
}

export interface CellPropertyFacts {
  leftMargin: number | null;
  rightMargin: number | null;
  topMargin: number | null;
  bottomMargin: number | null;
}

/** Exact non-appearance inverse for one complete table-format copy. */
export interface TablePropertyRestore {
  table: TablePropertyFacts;
  rows: Array<{
    row: RowPropertyFacts;
    cells: CellPropertyFacts[];
  }>;
}

export interface AppearanceRestore {
  cellAnchor: string;
  /**
   * Where this snapshot sits in its change set's write order.
   *
   * Appearance is not tracked, so a restore is an entry on an undo stack, and
   * an undo stack only composes in reverse. Two groups that write the same cell
   * each snapshot what THEY overwrote, so the earlier group's snapshot is only
   * the right value once the later group's has been put back - reject them in
   * the order the rail lists them and the later restore writes the earlier
   * group's fill back into the document. The sequence is what lets a reject
   * hand its snapshot down instead of racing a sibling; absent (an older tag),
   * the group replays on its own as it always did.
   */
  seq?: number;
  write?: AppearanceWrite;
  rowIsHeader?: boolean;
  tableBorders?: BorderWrite[];
  /** Row-level border topology captured before a sibling-format copy. */
  rowBorders?: BorderWrite[];
  /** Table and column geometry captured before a copied-layout write. */
  tableLayout?: TableLayoutFacts;
  /** Exact table, row, and cell properties captured before a sibling copy. */
  tableProperties?: TablePropertyRestore;
}

/**
 * The paragraph style a block wore before a change set touched the paragraph
 * next to it.
 *
 * SyncFusion has no Formatting revision type, so a paragraph's STYLE is never
 * part of what accepting or rejecting a card resolves. That is invisible until a
 * card's content resolution MERGES two paragraphs: rejecting an inserted
 * paragraph mark joins the inserted paragraph to the one after it, and the
 * survivor keeps the REMOVED paragraph's format. The content comes back exactly
 * right and the surviving paragraph is left wearing the wrong style, with no
 * revision to explain it - untracked damage that outlives a reject.
 *
 * This is a LIVE defect, not one the relocation ops introduced. It reproduces on
 * `insert_section` alone - insert a section before a Normal paragraph, reject the
 * card, and that paragraph comes back as a heading - and `insert_section` is
 * already shipped. Relocation only made it easy to see, because moving a
 * subsection above a top-level section puts two different styles either side of
 * one paste.
 *
 * Unlike an appearance restore this one must run AFTER the content resolves, not
 * before: the merge that loses the style is the resolution itself, so restoring
 * first would just be overwritten. And unlike an appearance restore it applies to
 * ACCEPT as well as reject - accepting a tracked delete merges its last mark into
 * the following paragraph and restyles that one just the same.
 *
 * `text` is what makes it safe to replay after either outcome. Block indices move
 * when a change set is accepted, so an anchor alone could name a different
 * paragraph entirely; a restore is applied only to a paragraph that still reads
 * the same, and never to one whose content the change set rewrote.
 */
export interface ParagraphStyleRestore {
  anchor: string;
  styleName: string;
  /** The paragraph's text when the style was captured (capped). */
  text: string;
}

/** How much paragraph text identifies a restore. Long enough to be unique. */
const PARAGRAPH_IDENTITY_LIMIT = 200;

export const paragraphIdentityText = (text: string): string =>
  text.slice(0, PARAGRAPH_IDENTITY_LIMIT);

export function preserveDocumentViewDuring<T>(
  editor: LiveEditor,
  operation: () => T,
  suppressOperationScroll = true
): T {
  const selection = editor.selection;
  const startOffset = selection?.startOffset;
  const endOffset = selection?.endOffset;
  const documentHelper = (editor as any).documentHelper;
  const viewer = documentHelper?.viewerContainer as HTMLElement | undefined;
  const scrollTop = viewer?.scrollTop;
  const scrollLeft = viewer?.scrollLeft;
  const previousSkipScroll = documentHelper?.skipScrollToPosition;
  if (documentHelper && suppressOperationScroll)
    documentHelper.skipScrollToPosition = true;
  try {
    return operation();
  } finally {
    if (
      typeof startOffset === 'string' &&
      typeof endOffset === 'string' &&
      (selection?.startOffset !== startOffset ||
        selection?.endOffset !== endOffset)
    ) {
      if (documentHelper) documentHelper.skipScrollToPosition = true;
      selection.select(startOffset, endOffset);
    }
    if (viewer) {
      if (typeof scrollTop === 'number') viewer.scrollTop = scrollTop;
      if (typeof scrollLeft === 'number') viewer.scrollLeft = scrollLeft;
    }
    if (documentHelper)
      documentHelper.skipScrollToPosition = previousSkipScroll;
  }
}

export function snapshotRevisions(editor: LiveEditor): LiveRevision[] {
  const collection = editor.revisions;
  if (!collection) return [];
  if (Array.isArray(collection.changes)) return collection.changes.slice();
  if (
    typeof collection.length === 'number' &&
    typeof collection.get === 'function'
  ) {
    const revisions: LiveRevision[] = [];
    for (let index = 0; index < collection.length; index++) {
      const revision = collection.get(index);
      if (revision) revisions.push(revision);
    }
    return revisions;
  }
  return [];
}

// snapshotRevisions without its defensive `.slice()`. Only for scans that
// read and discard within one synchronous call; never for a retained result.
const liveRevisionsRaw = (editor: LiveEditor): LiveRevision[] => {
  const collection = editor.revisions;
  if (collection && Array.isArray(collection.changes))
    return collection.changes;
  return snapshotRevisions(editor);
};

export function createdRevisions(
  editor: LiveEditor,
  before: LiveRevision[]
): LiveRevision[] {
  const existing = new Set(before);
  return snapshotRevisions(editor).filter(
    (revision) => !existing.has(revision)
  );
}

const REVISION_GROUP_TAG_VERSION = 1;
const PERSISTED_BORDER_TYPES = new Set([
  'AllBorders',
  'OutsideBorders',
  'LeftBorder',
  'RightBorder',
  'TopBorder',
  'BottomBorder',
  'NoBorder'
]);

interface RevisionGroupTag {
  changeSetId: string;
  group: string;
  appearanceRestores?: AppearanceRestore[];
  paragraphStyles?: ParagraphStyleRestore[];
}

export function revisionGroupTag(
  changeSetId: string,
  group: string,
  appearanceRestores?: AppearanceRestore[],
  paragraphStyles?: ParagraphStyleRestore[]
): string {
  return JSON.stringify({
    v: REVISION_GROUP_TAG_VERSION,
    source: 'robin',
    changeSetId,
    group,
    ...(appearanceRestores?.length ? { appearanceRestores } : {}),
    ...(paragraphStyles?.length ? { paragraphStyles } : {})
  });
}

function parsePersistedBorderWrites(value: unknown): BorderWrite[] | null {
  if (!Array.isArray(value)) return null;
  const borders: BorderWrite[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const border = item as Record<string, unknown>;
    if (
      typeof border.type !== 'string' ||
      !PERSISTED_BORDER_TYPES.has(border.type) ||
      typeof border.style !== 'string' ||
      !border.style
    )
      return null;
    if (
      border.width !== undefined &&
      (typeof border.width !== 'number' || !Number.isFinite(border.width))
    )
      return null;
    if (border.color !== undefined && typeof border.color !== 'string')
      return null;
    borders.push({
      type: border.type,
      style: border.style,
      ...(typeof border.width === 'number' ? { width: border.width } : {}),
      ...(typeof border.color === 'string' ? { color: border.color } : {})
    });
  }
  return borders;
}

function parsePersistedAppearanceWrite(value: unknown): AppearanceWrite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const write: AppearanceWrite = {};
  if ('shading' in raw) {
    if (raw.shading !== null && typeof raw.shading !== 'string') return null;
    write.shading = raw.shading as string | null;
  }
  if ('verticalAlignment' in raw) {
    if (!['Top', 'Center', 'Bottom'].includes(String(raw.verticalAlignment)))
      return null;
    write.verticalAlignment = raw.verticalAlignment as
      | 'Top'
      | 'Center'
      | 'Bottom';
  }
  if ('borders' in raw) {
    const borders = parsePersistedBorderWrites(raw.borders);
    if (!borders) return null;
    write.borders = borders;
  }
  return write.shading !== undefined ||
    write.verticalAlignment !== undefined ||
    write.borders !== undefined
    ? write
    : null;
}

function finiteNumber(
  raw: Record<string, unknown>,
  key: string
): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTablePropertyFacts(value: unknown): TablePropertyFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (finiteNumber(raw, 'cellSpacing') === null) return null;
  if (
    ['leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'].some(
      (key) => raw[key] !== null && finiteNumber(raw, key) === null
    )
  )
    return null;
  if (
    raw.horizontalPosition !== undefined &&
    finiteNumber(raw, 'horizontalPosition') === null
  )
    return null;
  if (typeof raw.bidi !== 'boolean') return null;
  const strings = [
    'styleName',
    'title',
    'description',
    'horizontalPositionAbs'
  ];
  if (
    strings.some(
      (key) => raw[key] !== undefined && typeof raw[key] !== 'string'
    )
  )
    return null;
  return raw as unknown as TablePropertyFacts;
}

function parseRowPropertyFacts(value: unknown): RowPropertyFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const numeric = [
    'height',
    'gridBefore',
    'gridBeforeWidth',
    'gridAfter',
    'gridAfterWidth',
    'leftIndent'
  ];
  if (numeric.some((key) => finiteNumber(raw, key) === null)) return null;
  if (
    ['leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'].some(
      (key) => raw[key] !== null && finiteNumber(raw, key) === null
    )
  )
    return null;
  if (typeof raw.allowBreakAcrossPages !== 'boolean') return null;
  if (typeof raw.heightType !== 'string') return null;
  if (
    !['Auto', 'Percent', 'Point'].includes(String(raw.gridBeforeWidthType)) ||
    !['Auto', 'Percent', 'Point'].includes(String(raw.gridAfterWidthType))
  )
    return null;
  return raw as unknown as RowPropertyFacts;
}

function parseCellPropertyFacts(value: unknown): CellPropertyFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    ['leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'].some(
      (key) => raw[key] !== null && finiteNumber(raw, key) === null
    )
  )
    return null;
  return raw as unknown as CellPropertyFacts;
}

function parseTablePropertyRestore(
  value: unknown
): TablePropertyRestore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const table = parseTablePropertyFacts(raw.table);
  if (!table || !Array.isArray(raw.rows)) return null;
  const rows: TablePropertyRestore['rows'] = [];
  for (const item of raw.rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const rowRaw = item as Record<string, unknown>;
    const row = parseRowPropertyFacts(rowRaw.row);
    if (!row || !Array.isArray(rowRaw.cells)) return null;
    const cells = rowRaw.cells.map(parseCellPropertyFacts);
    if (cells.some((cell) => !cell)) return null;
    rows.push({ row, cells: cells as CellPropertyFacts[] });
  }
  return { table, rows };
}

function parseTableLayoutFacts(value: unknown): TableLayoutFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    finiteNumber(raw, 'preferredWidth') === null ||
    finiteNumber(raw, 'leftIndent') === null ||
    !['Auto', 'Percent', 'Point'].includes(String(raw.preferredWidthType)) ||
    !['Left', 'Center', 'Right'].includes(String(raw.tableAlignment)) ||
    typeof raw.allowAutoFit !== 'boolean'
  )
    return null;
  if (
    raw.columnWidths !== undefined &&
    (!Array.isArray(raw.columnWidths) ||
      raw.columnWidths.some(
        (width) => typeof width !== 'number' || !Number.isFinite(width)
      ))
  )
    return null;
  if (
    raw.columnWidthType !== undefined &&
    !['Auto', 'Percent', 'Point'].includes(String(raw.columnWidthType))
  )
    return null;
  return raw as unknown as TableLayoutFacts;
}

function parsePersistedAppearanceRestores(
  value: unknown
): AppearanceRestore[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const restores: AppearanceRestore[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return undefined;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.cellAnchor !== 'string' ||
      !/^\d+;\d+;\d+;\d+;\d+$/.test(raw.cellAnchor)
    )
      return undefined;
    if (raw.rowIsHeader !== undefined && typeof raw.rowIsHeader !== 'boolean')
      return undefined;
    const write =
      raw.write === undefined
        ? undefined
        : parsePersistedAppearanceWrite(raw.write);
    if (raw.write !== undefined && !write) return undefined;
    const tableBorders =
      raw.tableBorders === undefined
        ? undefined
        : parsePersistedBorderWrites(raw.tableBorders);
    if (raw.tableBorders !== undefined && !tableBorders?.length)
      return undefined;
    const rowBorders =
      raw.rowBorders === undefined
        ? undefined
        : parsePersistedBorderWrites(raw.rowBorders);
    if (raw.rowBorders !== undefined && !rowBorders?.length) return undefined;
    const tableLayout =
      raw.tableLayout === undefined
        ? undefined
        : parseTableLayoutFacts(raw.tableLayout);
    if (raw.tableLayout !== undefined && !tableLayout) return undefined;
    const tableProperties =
      raw.tableProperties === undefined
        ? undefined
        : parseTablePropertyRestore(raw.tableProperties);
    if (raw.tableProperties !== undefined && !tableProperties) return undefined;
    if (
      raw.rowIsHeader === undefined &&
      !write &&
      !tableBorders &&
      !rowBorders &&
      !tableLayout &&
      !tableProperties
    )
      return undefined;
    if (
      raw.seq !== undefined &&
      (typeof raw.seq !== 'number' || !Number.isFinite(raw.seq))
    )
      return undefined;
    restores.push({
      cellAnchor: raw.cellAnchor,
      ...(typeof raw.seq === 'number' ? { seq: raw.seq } : {}),
      ...(typeof raw.rowIsHeader === 'boolean'
        ? { rowIsHeader: raw.rowIsHeader }
        : {}),
      ...(write ? { write } : {}),
      ...(tableBorders ? { tableBorders } : {}),
      ...(rowBorders ? { rowBorders } : {}),
      ...(tableLayout ? { tableLayout } : {}),
      ...(tableProperties ? { tableProperties } : {})
    });
  }
  return restores;
}

/** Persisted paragraph-style restores, validated like every other tag payload. */
function parsePersistedParagraphStyles(
  value: unknown
): ParagraphStyleRestore[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const restores: ParagraphStyleRestore[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return undefined;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.anchor !== 'string' || !/^\d+;\d+$/.test(entry.anchor))
      return undefined;
    if (typeof entry.styleName !== 'string' || !entry.styleName.trim())
      return undefined;
    if (typeof entry.text !== 'string') return undefined;
    restores.push({
      anchor: entry.anchor,
      styleName: entry.styleName,
      text: entry.text
    });
  }
  return restores;
}

export function parseRevisionGroupTag(
  customData: unknown
): RevisionGroupTag | undefined {
  if (typeof customData !== 'string' || !customData.trim()) return undefined;
  try {
    const parsed = JSON.parse(customData);
    if (
      parsed &&
      parsed.source === 'robin' &&
      typeof parsed.changeSetId === 'string' &&
      typeof parsed.group === 'string'
    ) {
      const appearanceRestores = parsePersistedAppearanceRestores(
        parsed.appearanceRestores
      );
      const paragraphStyles = parsePersistedParagraphStyles(
        parsed.paragraphStyles
      );
      return {
        changeSetId: parsed.changeSetId,
        group: parsed.group,
        ...(appearanceRestores ? { appearanceRestores } : {}),
        ...(paragraphStyles ? { paragraphStyles } : {})
      };
    }
  } catch {
    // Foreign customData stays outside assistant grouping.
  }
  return undefined;
}

const REVISION_ISOLATION_INSTALLED = '__robinRevisionGroupIsolation';

const revisionTagKey = (customData: unknown): string => {
  const tag = parseRevisionGroupTag(customData);
  return tag ? `${tag.changeSetId} ${tag.group}` : '';
};

export function installRevisionGroupIsolation(editor: LiveEditor): void {
  const module: any = (editor as any).editorModule ?? editor.editor;
  if (!module || typeof module.isRevisionMatched !== 'function') return;
  if (module[REVISION_ISOLATION_INSTALLED]) return;
  module[REVISION_ISOLATION_INSTALLED] = true;
  const activeKey = () =>
    revisionTagKey(editor.documentEditorSettings?.revisionSettings?.customData);
  const originalMatched = module.isRevisionMatched.bind(module);
  module.isRevisionMatched = (item: any, type: any): boolean => {
    if (type === undefined || type === null) return originalMatched(item, type);
    const revisions: any[] =
      item && typeof item.revisionLength === 'number'
        ? Array.from(
            { length: item.revisionLength },
            (_, index) => item.revisions?.[index]
          )
        : [item];
    const key = activeKey();
    return revisions.some(
      (revision) =>
        revision &&
        originalMatched(revision, type) &&
        revisionTagKey(revision.customData) === key
    );
  };
  if (typeof module.compareTwoRevisions === 'function') {
    const originalCompare = module.compareTwoRevisions.bind(module);
    module.compareTwoRevisions = (left: any, right: any): boolean =>
      originalCompare(left, right) &&
      revisionTagKey(left?.customData) === revisionTagKey(right?.customData);
  }
}

type NativeResolvers = {
  accept?: () => void;
  reject?: () => void;
  single?: (isAccept: boolean, isGroup: boolean) => void;
};

const captureNativeResolvers = (revision: LiveRevision): NativeResolvers => ({
  accept:
    typeof revision.accept === 'function'
      ? revision.accept.bind(revision)
      : undefined,
  reject:
    typeof revision.reject === 'function'
      ? revision.reject.bind(revision)
      : undefined,
  single:
    typeof revision.handleAcceptReject === 'function'
      ? revision.handleAcceptReject.bind(revision)
      : undefined
});

const resolveSingleRevision = (
  resolvers: NativeResolvers,
  isAccept: boolean
): void => {
  if (resolvers.single) resolvers.single(isAccept, false);
  else (isAccept ? resolvers.accept : resolvers.reject)?.();
};

export const invalidateDocumentLayout = (editor: LiveEditor): void => {
  preserveDocumentViewDuring(
    editor,
    () => {
      try {
        (editor as any).documentHelper?.layout?.layoutWholeDocument?.();
      } catch {
        // Resolution already succeeded; teardown layout is best-effort.
      }
    },
    false
  );
};

/**
 * A restore plus the cell it belongs to, held as a widget rather than an index.
 *
 * `cellAnchor` names a POSITION, and by the time an inverse replays, the very
 * change it is undoing has usually moved it: rejecting an inserted row
 * renumbers every row below it, rejecting an inserted section renumbers every
 * block after it. Resolving the anchor to the cell's first paragraph while it
 * is still valid, then asking the SDK where that widget sits at replay time, is
 * the same identity-over-position rule `replayParagraphStyles` already follows.
 * A widget the document no longer holds restores nothing - the cell went away
 * with the change the restore was part of, so there is nothing to put back.
 */
export interface AppearanceTarget {
  restore: AppearanceRestore;
  /** The first paragraph of the cell the restore names, captured live. */
  paragraph?: unknown;
}

const APPEARANCE_LEDGER = '__robinAppearanceLedger';
const APPEARANCE_LEDGER_BATCH = '__robinAppearanceLedgerBatch';

type LedgerEntry = {
  /**
   * Which registration this snapshot arrived in. Cards land one change set at a
   * time, so the batch orders snapshots ACROSS change sets and `seq` orders them
   * within one - the pair is the write order the stack has to unwind.
   */
  batch: number;
  seq: number;
  /** The cell and kind of write this snapshot undoes. */
  key: string;
  groupKey: string;
  restore: AppearanceRestore;
  target?: AppearanceTarget;
  pending: boolean;
};

/**
 * What a restore undoes, so two snapshots of the same thing can be recognised
 * as entries on one stack. Different kinds on one cell do not interact.
 */
const restoreKey = (restore: AppearanceRestore): string => {
  const kinds = [
    restore.write ? 'write' : '',
    restore.rowIsHeader !== undefined ? 'rowIsHeader' : '',
    restore.tableBorders ? 'tableBorders' : '',
    restore.rowBorders ? 'rowBorders' : '',
    restore.tableLayout ? 'tableLayout' : '',
    restore.tableProperties ? 'tableProperties' : ''
  ].filter(Boolean);
  return `${restore.cellAnchor}\u0000${kinds.join(',')}`;
};

/**
 * Every still-unplayed appearance snapshot in the document, in write order.
 *
 * The DOCUMENT owns this, not the card and not the change set. The rail
 * partitions a change set into cards and shows several turns' cards at once,
 * but the writes behind them went in one after another, and only the newest
 * snapshot of a given cell puts back a real value. Two cards on one cell are
 * the same defect whether they came from one turn or two.
 *
 * Write order is `(batch, seq)`: `seq` is exact, having been recorded when the
 * change set wrote it, and the batch is the order the cards bound in. After a
 * reload the batches follow document order rather than the order the turns
 * happened, so cross-change-set ordering degrades to that; within a change set
 * it stays exact, which is where the cards the rail groups together live.
 */
const appearanceLedger = (editor: LiveEditor): LedgerEntry[] =>
  ((editor as any)[APPEARANCE_LEDGER] ??= []);

const nextLedgerBatch = (editor: LiveEditor): number =>
  ((editor as any)[APPEARANCE_LEDGER_BATCH] =
    ((editor as any)[APPEARANCE_LEDGER_BATCH] ?? 0) + 1);

/** Write order across the whole document: the batch first, then the seq. */
const inWriteOrder = (left: LedgerEntry, right: LedgerEntry): number =>
  left.batch - right.batch || left.seq - right.seq;

const isNewerThan = (left: LedgerEntry, right: LedgerEntry): boolean =>
  inWriteOrder(left, right) > 0;

export function groupRevisionsAtomic(
  editor: LiveEditor,
  group: LiveRevision[],
  changeSetId?: string,
  groupId?: string,
  appearanceRestores?: AppearanceRestore[],
  paragraphStyles?: ParagraphStyleRestore[]
): void {
  if (!group.length) return;
  const members = group.map(captureNativeResolvers);
  const state = { resolved: false, restored: false, settled: false };
  const resolvedAlone = new Set<number>();
  const acceptedAlone = new Set<number>();
  // This binding's identity. A group is finished when the document holds none
  // of its revisions - the only reading that survives SyncFusion dropping a
  // member as a side effect of resolving its neighbour, which a count of
  // resolve calls does not.
  const token = {};
  const groupKey = `${changeSetId ?? ''}\u0000${groupId ?? ''}`;
  const ledger = changeSetId ? appearanceLedger(editor) : undefined;
  if (ledger && appearanceRestores?.length) {
    // Re-binding the same card (a reload, an undo) replaces its entries rather
    // than stacking a second copy of the same snapshots.
    for (let index = ledger.length - 1; index >= 0; index--)
      if (ledger[index].groupKey === groupKey) ledger.splice(index, 1);
    const batch = nextLedgerBatch(editor);
    appearanceRestores.forEach((restore, index) =>
      ledger.push({
        batch,
        seq: restore.seq ?? index,
        key: restoreKey(restore),
        groupKey,
        restore,
        pending: true
      })
    );
  }
  /**
   * Bind every snapshot to its live cell, here at binding time - straight after
   * the change set wrote it, or straight after a reload rebuilt the card from
   * its tag. That is the only moment the anchors are certainly still valid:
   * waiting until this card starts resolving is too late, because a SIBLING
   * card rejected first has already moved the rows underneath it.
   */
  const bindAppearanceTargets = () => {
    if (!ledger || state.restored) return;
    state.restored = true;
    const mine = ledger.filter(
      (entry) => entry.groupKey === groupKey && entry.pending && !entry.target
    );
    if (!mine.length) return;
    preserveDocumentViewDuring(editor, () => {
      for (const entry of mine)
        entry.target = resolveAppearanceTargets(editor, [entry.restore])[0];
    });
  };
  /**
   * The appearance inverse, settled once the group is finished.
   *
   * Accepting any member keeps part of the change, so nothing is repainted -
   * and every older snapshot of the same cell is now unreachable, because what
   * the user kept is what stands. Rejecting the whole group hands a snapshot
   * down to the newest sibling still holding the same cell, and writes only
   * when it is the last one left; that is what makes rejecting cards in the
   * order the rail lists them end at the value that predates the change set.
   */
  const settleAppearance = (accepted: boolean) => {
    if (!ledger) return;
    const mine = ledger
      .filter((entry) => entry.groupKey === groupKey && entry.pending)
      .sort((left, right) => inWriteOrder(right, left));
    const play: AppearanceTarget[] = [];
    for (const entry of mine) {
      entry.pending = false;
      const siblings = ledger.filter(
        (other) => other.pending && other.key === entry.key
      );
      if (accepted) {
        for (const older of siblings)
          if (isNewerThan(entry, older)) older.pending = false;
        continue;
      }
      const heir = siblings
        .filter((other) => isNewerThan(other, entry))
        .sort(inWriteOrder)[0];
      if (heir) heir.restore = entry.restore;
      // The bound target carries the cell; the payload is whatever this entry
      // holds now, which is not what it held when the target was bound if an
      // older sibling handed its snapshot down.
      else play.push({ ...entry.target, restore: entry.restore });
    }
    if (!play.length) return;
    try {
      // Newest first, which is how the replay walks its list.
      replayAppearanceRestores(editor, play.reverse());
    } catch {
      // Content still resolves consistently if an appearance restore fails.
    }
  };
  /**
   * The paragraph-style inverse, settled with the appearance one and on either
   * outcome: accepting a tracked delete merges its last mark into the following
   * paragraph and restyles that one exactly as rejecting an insertion does.
   * Identity matching in the replay is what makes it safe here, where the
   * indices have moved.
   */
  const restoreParagraphStyles = () => {
    if (state.settled || !paragraphStyles?.length) return;
    state.settled = true;
    try {
      replayParagraphStyles(editor, paragraphStyles);
    } catch {
      // Content still resolves consistently if a style restore fails.
    }
  };
  const groupHasLiveMembers = () =>
    snapshotRevisions(editor).some(
      (revision) => (revision as any).robinGroupToken === token
    );
  const settleIfFinished = () => {
    if (groupHasLiveMembers()) return;
    settleAppearance(acceptedAlone.size > 0);
    restoreParagraphStyles();
  };
  const resolveAll = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    for (let index = 0; index < members.length; index++) {
      if (resolvedAlone.has(index)) continue;
      if (isAccept) acceptedAlone.add(index);
      try {
        resolveSingleRevision(members[index], isAccept);
      } catch {
        // A later member can become stale after the first resolves.
      }
    }
    settleIfFinished();
    if (members.length > 1) invalidateDocumentLayout(editor);
  };
  group.forEach((revision, index) => {
    if (changeSetId) (revision as any).robinChangeSetId = changeSetId;
    if (groupId) (revision as any).robinGroupId = groupId;
    (revision as any).robinGroupBound = true;
    (revision as any).robinGroupToken = token;
    (revision as any).robinResolveSelf = (isAccept: boolean) => {
      if (state.resolved || resolvedAlone.has(index)) return;
      // The non-cascading path the review rail resolves every card through:
      // per-chip, per-card and rail-wide all arrive here, member by member.
      resolvedAlone.add(index);
      if (isAccept) acceptedAlone.add(index);
      resolveSingleRevision(members[index], isAccept);
      settleIfFinished();
    };
    (revision as any).robinReviveSelf = () => {
      state.resolved = false;
      state.settled = false;
      resolvedAlone.delete(index);
      acceptedAlone.delete(index);
    };
    revision.accept = () => resolveAll(true);
    revision.reject = () => resolveAll(false);
  });
  bindAppearanceTargets();
}

export function resolveRevisionIndividually(
  revision: LiveRevision,
  isAccept: boolean
): void {
  const resolveSelf = (revision as any).robinResolveSelf;
  if (typeof resolveSelf === 'function') resolveSelf(isAccept);
  else resolveSingleRevision(captureNativeResolvers(revision), isAccept);
}

type RevisionMemberIdentity = {
  revisionID?: string;
  groupKey: string;
  author: string;
  original: LiveRevision;
};

const revisionMemberIdentity = (
  revision: LiveRevision
): RevisionMemberIdentity => {
  const revisionID = String(revision.revisionID ?? '').trim();
  return {
    ...(revisionID ? { revisionID } : {}),
    groupKey: revisionTagKey(revision.customData),
    author: String(revision.author ?? ''),
    original: revision
  };
};

type RevisionIndex = {
  byRef: Set<LiveRevision>;
  byKey: Map<string, LiveRevision>;
};

const revisionIdentityKey = (
  revisionID: string,
  groupKey: string,
  author: string
): string => `${revisionID}\u0000${groupKey}\u0000${author}`;

// Built once per resolve call, not once per revision: O(n) instead of O(k*n).
// A miss is always a permanent removal (an earlier identity cascaded its
// atomic group), never a stale read worth re-scanning for.
const buildRevisionIndex = (editor: LiveEditor): RevisionIndex => {
  const byRef = new Set<LiveRevision>();
  const byKey = new Map<string, LiveRevision>();
  for (const revision of liveRevisionsRaw(editor)) {
    byRef.add(revision);
    const revisionID = String(revision.revisionID ?? '').trim();
    if (revisionID) {
      byKey.set(
        revisionIdentityKey(
          revisionID,
          revisionTagKey(revision.customData),
          String(revision.author ?? '')
        ),
        revision
      );
    }
  }
  return { byRef, byKey };
};

const lookupRevision = (
  index: RevisionIndex,
  identity: RevisionMemberIdentity
): LiveRevision | undefined => {
  if (index.byRef.has(identity.original)) return identity.original;
  if (!identity.revisionID) return undefined;
  return index.byKey.get(
    revisionIdentityKey(identity.revisionID, identity.groupKey, identity.author)
  );
};

export function resolveRevisionsAsOneUndo(
  editor: LiveEditor,
  revisions: LiveRevision[],
  isAccept: boolean
): void {
  const identities = revisions.map(revisionMemberIdentity);
  const editorModule: any = (editor as any).editorModule ?? editor.editor;
  const history: any =
    (editor as any).editorHistoryModule ?? (editor as any).editorHistory;
  let complex = false;
  if (
    revisions.length > 1 &&
    typeof editorModule?.initComplexHistory === 'function'
  ) {
    try {
      editorModule.initComplexHistory(isAccept ? 'Accept All' : 'Reject All');
      complex = true;
    } catch {
      complex = false;
    }
  }
  const index = buildRevisionIndex(editor);
  try {
    for (const identity of [...identities].reverse()) {
      const revision = lookupRevision(index, identity);
      if (!revision) continue;
      (revision as any).robinReviveSelf?.();
      try {
        resolveRevisionIndividually(revision, isAccept);
      } catch {
        // A stale member does not stop the remaining unit.
      }
    }
  } finally {
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping cannot undo a completed resolution.
      }
    }
  }
  if (revisions.length > 1) invalidateDocumentLayout(editor);
}

export interface RevisionGroupIdentity {
  changeSetId: string;
  group: string;
  untagged?: boolean;
}

export function resolveLiveRevisionGroupsAsOneUndo(
  editor: LiveEditor,
  groups: RevisionGroupIdentity[],
  isAccept: boolean
): LiveRevision[] {
  const tagged = new Set(
    groups
      .filter((group) => !group.untagged)
      .map((group) => `${group.changeSetId}\u0000${group.group}`)
  );
  const authors = new Set(
    groups.filter((group) => group.untagged).map((group) => group.group)
  );
  const matchesGroup = (revision: LiveRevision) => {
    const tag = parseRevisionGroupTag(revision.customData);
    return tag
      ? tagged.has(`${tag.changeSetId}\u0000${tag.group}`)
      : authors.has(String(revision.author ?? '').trim() || 'Unknown author');
  };
  const initial = liveRevisionsRaw(editor).filter(matchesGroup);
  const resolved: LiveRevision[] = [];
  const editorModule: any = (editor as any).editorModule ?? editor.editor;
  const history: any =
    (editor as any).editorHistoryModule ?? (editor as any).editorHistory;
  let complex = false;
  if (
    initial.length > 1 &&
    typeof editorModule?.initComplexHistory === 'function'
  ) {
    try {
      editorModule.initComplexHistory(isAccept ? 'Accept All' : 'Reject All');
      complex = true;
    } catch {
      complex = false;
    }
  }
  try {
    let budget = Math.max(20, initial.length * 4);
    // Without this, a revision that throws stays at current[0]/current[last]
    // and is retried until the budget is gone, starving the rest of the group.
    const failed = new Set<LiveRevision>();
    while (budget-- > 0) {
      const current = liveRevisionsRaw(editor).filter(
        (revision) => matchesGroup(revision) && !failed.has(revision)
      );
      if (!current.length) break;
      const revision = isAccept ? current[0] : current[current.length - 1];
      (revision as any).robinReviveSelf?.();
      resolved.push(revision);
      try {
        resolveRevisionIndividually(revision, isAccept);
      } catch {
        failed.add(revision);
        // The bounded loop can continue with the next current member.
      }
    }
  } finally {
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping cannot undo a completed resolution.
      }
    }
  }
  if (initial.length) invalidateDocumentLayout(editor);
  return resolved;
}

export interface RevisionGroupItem {
  /** The first revision of the chip; what the rail focuses and scrolls to. */
  revision: LiveRevision;
  /**
   * Everything this chip resolves. A chip is a PARAGRAPH's worth of change, not
   * a single SyncFusion revision: resolving a paragraph's text apart from its
   * own paragraph mark merges it into its neighbour, which no inverse can put
   * back. Every resolve path has to settle the whole array with one decision.
   */
  revisions: LiveRevision[];
  revisionType: string;
  text: string;
  beforeText?: string;
  partner?: LiveRevision;
  /** The insertion half of a replace chip, resolved with the deletion half. */
  partnerRevisions?: LiveRevision[];
  author?: string;
  /** The paragraph this chip belongs to; how members are collected. */
  paragraph?: unknown;
}

/** The paragraph a revision lives in: a text run's, or the mark's own owner. */
const revisionParagraph = (revision: LiveRevision): unknown => {
  let range: any[];
  try {
    range = typeof revision.getRange === 'function' ? revision.getRange() : [];
  } catch {
    return undefined;
  }
  const node = Array.isArray(range) ? range[0] : undefined;
  return node?.line?.paragraph ?? node?.ownerBase ?? undefined;
};

interface RevisionGroupView {
  changeSetId: string;
  group: string;
  untagged?: boolean;
  items: RevisionGroupItem[];
}

const revisionRangeText = (revision: LiveRevision): string => {
  let range: any[];
  try {
    range = typeof revision.getRange === 'function' ? revision.getRange() : [];
  } catch {
    return '';
  }
  if (!Array.isArray(range)) return '';
  return range
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('')
    .trim();
};

const isReplacePair = (
  deletion: LiveRevision,
  insertion: LiveRevision
): boolean => {
  try {
    const deletionRange = deletion.getRange?.() ?? [];
    const insertionRange = insertion.getRange?.() ?? [];
    const last = deletionRange[deletionRange.length - 1];
    return !!last && !!insertionRange[0] && last.nextNode === insertionRange[0];
  } catch {
    return false;
  }
};

const REPLACE_COUNTERPART_MEMO = '__robinReplaceCounterpart';

const sameEditUnit = (left: LiveRevision, right: LiveRevision): boolean => {
  const leftTag = parseRevisionGroupTag(left.customData);
  const rightTag = parseRevisionGroupTag(right.customData);
  if (leftTag && rightTag)
    return (
      leftTag.changeSetId === rightTag.changeSetId &&
      leftTag.group === rightTag.group
    );
  if (!leftTag && !rightTag)
    return String(left.author ?? '') === String(right.author ?? '');
  return false;
};

const computeReplaceCounterpart = (
  revision: LiveRevision
): LiveRevision | undefined => {
  const type = String(revision.revisionType ?? '');
  if (type !== 'Deletion' && type !== 'Insertion') return undefined;
  let range: any[];
  try {
    range = revision.getRange?.() ?? [];
  } catch {
    return undefined;
  }
  if (!Array.isArray(range) || !range.length) return undefined;
  const neighbour =
    type === 'Deletion'
      ? range[range.length - 1]?.nextNode
      : range[0]?.previousNode;
  const count = neighbour?.revisionLength ?? 0;
  for (let index = 0; index < count; index++) {
    const other = neighbour.getRevision?.(index);
    if (!other) continue;
    const otherType = String(other.revisionType ?? '');
    if (otherType !== (type === 'Deletion' ? 'Insertion' : 'Deletion'))
      continue;
    if (!sameEditUnit(revision, other)) continue;
    const deletion = type === 'Deletion' ? revision : other;
    const insertion = type === 'Deletion' ? other : revision;
    if (isReplacePair(deletion, insertion)) return other;
  }
  return undefined;
};

export function findReplaceCounterpart(
  revision: LiveRevision
): LiveRevision | undefined {
  const memo = (revision as any)[REPLACE_COUNTERPART_MEMO];
  if (memo !== undefined) return memo ?? undefined;
  const counterpart = computeReplaceCounterpart(revision);
  (revision as any)[REPLACE_COUNTERPART_MEMO] = counterpart ?? null;
  if (counterpart) (counterpart as any)[REPLACE_COUNTERPART_MEMO] = revision;
  return counterpart;
}

export function listRevisionGroups(editor: LiveEditor): RevisionGroupView[] {
  const views = new Map<string, RevisionGroupView>();
  for (const revision of snapshotRevisions(editor)) {
    const tag = parseRevisionGroupTag(revision.customData);
    const author = String(revision.author ?? '').trim() || 'Unknown author';
    const key = tag ? `${tag.changeSetId} ${tag.group}` : `author ${author}`;
    let view = views.get(key);
    if (!view) {
      view = tag
        ? { changeSetId: tag.changeSetId, group: tag.group, items: [] }
        : { changeSetId: '', group: author, untagged: true, items: [] };
      views.set(key, view);
    }
    const revisionType = String(revision.revisionType ?? '');
    const paragraph = revisionParagraph(revision);
    const previous = view.items[view.items.length - 1];
    // Same paragraph, same direction: one chip. SyncFusion tracks a
    // paragraph's text and its MARK as separate revisions, and the mark is not
    // an edit anyone reviews - it is what makes the paragraph a paragraph. Left
    // separable, accepting the text and rejecting the mark deletes the boundary
    // between the accepted paragraph and the next one and welds two headings
    // into one, with no card left to undo it. The rail also stopped listing the
    // empty chips those marks used to produce.
    if (
      previous &&
      !previous.partner &&
      previous.revisionType === revisionType &&
      paragraph !== undefined &&
      previous.paragraph === paragraph
    ) {
      previous.revisions.push(revision);
      previous.text = `${previous.text}${
        previous.text ? ' ' : ''
      }${revisionRangeText(revision)}`.trim();
      continue;
    }
    const item: RevisionGroupItem = {
      revision,
      revisions: [revision],
      revisionType,
      text: revisionRangeText(revision),
      author,
      ...(paragraph !== undefined ? { paragraph } : {})
    };
    if (
      previous &&
      !previous.partner &&
      previous.revisionType === 'Deletion' &&
      item.revisionType === 'Insertion' &&
      isReplacePair(
        previous.revisions[previous.revisions.length - 1],
        item.revision
      )
    ) {
      previous.partner = item.revision;
      previous.partnerRevisions = item.revisions;
      previous.revisionType = 'Replace';
      previous.beforeText = previous.text;
      previous.text = item.text;
    } else view.items.push(item);
  }
  return [...views.values()];
}

const selectForAppearance = (
  editor: LiveEditor,
  cellAnchor: string,
  extent: 'cell' | 'row'
) => {
  editor.selection.select(`${cellAnchor};0`, `${cellAnchor};0`);
  const method = extent === 'row' ? 'selectRow' : 'selectCell';
  editor.selection?.[method]?.();
};

const applyBorders = (editor: LiveEditor, borders: BorderWrite[]) => {
  for (const border of borders) {
    editor.editor?.applyBorders?.({
      type: border.type,
      borderStyle: border.style,
      ...(border.width != null ? { lineWidth: border.width } : {}),
      ...(border.color ? { borderColor: border.color } : {})
    });
  }
};

/** The rendered table widget an anchor names, or undefined when none does. */
export function liveTableWidgetAt(
  editor: LiveEditor,
  tableAnchor: string
): any {
  selectForAppearance(editor, `${tableAnchor};0;0;0`, 'cell');
  const cell = (editor as any).selection?.start?.paragraph?.associatedCell;
  return cell?.ownerTable?.combineWidget?.((editor as any).viewer);
}

const assignFacts = (target: any, facts: Record<string, unknown>): void => {
  for (const [property, value] of Object.entries(facts))
    target[property] = value;
};

/**
 * Write sampled table, row, and cell SDK properties straight onto the rendered
 * widget formats. The engine's post-write verification, not this writer, is
 * what proves the values landed.
 */
export function writeTableProperties(
  editor: LiveEditor,
  tableAnchor: string,
  restore: TablePropertyRestore
): void {
  const table = liveTableWidgetAt(editor, tableAnchor);
  if (!table) return;
  assignFacts(
    table.tableFormat,
    restore.table as unknown as Record<string, unknown>
  );
  (table.childWidgets ?? []).forEach((row: any, rowIndex: number) => {
    const sourceRow = restore.rows[rowIndex];
    if (!sourceRow) return;
    const { height, heightType, ...rowFacts } = sourceRow.row;
    assignFacts(row.rowFormat, rowFacts as unknown as Record<string, unknown>);
    // SyncFusion clears an explicit height when its type changes. Apply the
    // type first so the sampled sibling height survives the normalization.
    row.rowFormat.heightType = heightType;
    row.rowFormat.height = height;
    (row.childWidgets ?? []).forEach((cell: any, column: number) => {
      const sourceCell = sourceRow.cells[column];
      if (sourceCell)
        assignFacts(
          cell.cellFormat,
          sourceCell as unknown as Record<string, unknown>
        );
    });
  });
}

/** Write table placement, width mode, and per-column widths via the public API. */
export function writeTableLayout(
  editor: LiveEditor,
  tableAnchor: string,
  layout: TableLayoutFacts
): void {
  const firstCell = `${tableAnchor};0;0;0`;
  const selectTable = () => {
    selectForAppearance(editor, firstCell, 'cell');
    editor.selection?.selectTable?.();
  };
  selectTable();
  editor.editor?.autoFitTable?.(
    layout.allowAutoFit ? 'FitToContents' : 'FixedColumnWidth'
  );
  const columnWidths = layout.columnWidths ?? [];
  for (let column = 0; column < columnWidths.length; column++) {
    selectForAppearance(editor, `${tableAnchor};0;${column};0`, 'cell');
    editor.selection?.selectColumn?.();
    const cellFormat = editor.selection?.cellFormat;
    if (!cellFormat) continue;
    cellFormat.preferredWidth = columnWidths[column];
    cellFormat.preferredWidthType = layout.columnWidthType ?? 'Auto';
  }
  // FixedColumnWidth first establishes the SDK's defined cell-width flags. Run
  // it again after the sampled widths land so the live table grid is rebuilt
  // from those widths rather than the equal grid SyncFusion inserted.
  if (!layout.allowAutoFit && columnWidths.length) {
    selectTable();
    editor.editor?.autoFitTable?.('FixedColumnWidth');
  }
  selectTable();
  const tableFormat = editor.selection?.tableFormat;
  if (!tableFormat) return;
  tableFormat.preferredWidthType = layout.preferredWidthType;
  tableFormat.preferredWidth = layout.preferredWidth;
  tableFormat.tableAlignment = layout.tableAlignment;
  tableFormat.leftIndent = layout.leftIndent;
}

const cellParagraphAt = (editor: LiveEditor, cellAnchor: string): unknown => {
  try {
    editor.selection.select(`${cellAnchor};0`, `${cellAnchor};0`);
    return (editor as any).selection?.start?.paragraph ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Bind every restore to its live cell, while the anchors it names still hold.
 * Called before the first member of a group resolves, which is the last moment
 * at which that is true.
 */
export const resolveAppearanceTargets = (
  editor: LiveEditor,
  restores: AppearanceRestore[]
): AppearanceTarget[] =>
  restores.map((restore) => ({
    restore,
    paragraph: cellParagraphAt(editor, restore.cellAnchor)
  }));

/** The anchor that names this widget NOW, or nothing if the document dropped it. */
const liveCellAnchorOf = (
  editor: LiveEditor,
  paragraph: unknown
): string | undefined => {
  if (!paragraph) return undefined;
  let index: unknown;
  try {
    index = (editor as any).selection?.getHierarchicalIndex?.(paragraph, '0');
  } catch {
    return undefined;
  }
  if (typeof index !== 'string') return undefined;
  const parts = index.split(';');
  // Fewer than five parts means the widget is no longer inside a table cell.
  if (parts.length < 5) return undefined;
  const cellAnchor = parts.slice(0, 5).join(';');
  // The derived anchor has to lead back to the SAME widget. Without that check
  // a detached widget still answers with a plausible index, and writing through
  // it is the positional failure this exists to avoid.
  return cellParagraphAt(editor, cellAnchor) === paragraph
    ? cellAnchor
    : undefined;
};

const replayAppearanceRestores = (
  editor: LiveEditor,
  targets: AppearanceTarget[]
) => {
  for (let index = targets.length - 1; index >= 0; index--) {
    const { restore, paragraph } = targets[index];
    // No widget was ever bound (a tag read straight off a reloaded document):
    // the stored anchor is all there is, and it is still correct until the
    // group starts resolving. A widget that WAS bound and is now gone restores
    // nothing rather than repainting whatever moved into its place.
    const anchor = paragraph
      ? liveCellAnchorOf(editor, paragraph)
      : restore.cellAnchor;
    if (!anchor) continue;
    const tableAnchor = anchor.split(';').slice(0, 2).join(';');
    if (restore.tableProperties)
      writeTableProperties(editor, tableAnchor, restore.tableProperties);
    if (restore.tableLayout)
      writeTableLayout(editor, tableAnchor, restore.tableLayout);
    if (restore.tableBorders) {
      const firstCell = `${tableAnchor};0;0;0`;
      const selectTable = () => {
        selectForAppearance(editor, firstCell, 'cell');
        editor.selection?.selectTable?.();
      };
      selectTable();
      for (const border of restore.tableBorders) {
        applyBorders(editor, [border]);
        selectTable();
      }
    }
    if (restore.rowBorders) {
      selectForAppearance(editor, anchor, 'row');
      for (const border of restore.rowBorders) {
        applyBorders(editor, [border]);
        selectForAppearance(editor, anchor, 'row');
      }
    }
    if (restore.rowIsHeader !== undefined) {
      selectForAppearance(editor, anchor, 'row');
      if (editor.selection?.rowFormat)
        editor.selection.rowFormat.isHeader = restore.rowIsHeader;
    }
    if (restore.write) {
      selectForAppearance(editor, anchor, 'cell');
      const cellFormat = editor.selection?.cellFormat;
      if (cellFormat) {
        if (restore.write.shading !== undefined)
          cellFormat.background = restore.write.shading ?? 'empty';
        if (restore.write.verticalAlignment)
          cellFormat.verticalAlignment = restore.write.verticalAlignment;
      }
      for (const border of restore.write.borders ?? []) {
        applyBorders(editor, [border]);
        selectForAppearance(editor, anchor, 'cell');
      }
    }
  }
};

/**
 * Put back the paragraph styles a resolution merged away, after either outcome.
 *
 * Identity, not position, decides what gets written: a restore applies only to a
 * paragraph that still reads exactly as it did when the style was captured. That
 * is what makes it safe after an ACCEPT, where block indices have moved and the
 * captured anchor may now name a completely different paragraph - and it also
 * means a paragraph whose text the change set rewrote is never touched, because
 * its identity no longer matches. When the text appears more than once and the
 * anchor does not settle it, nothing is written rather than the wrong one.
 *
 * A paragraph already reading the right style is left alone, so this never
 * overwrites a style someone set deliberately. A collapsed caret is enough:
 * SyncFusion applies a paragraph style to the paragraph containing the selection.
 */
export const replayParagraphStyles = (
  editor: LiveEditor,
  restores: ParagraphStyleRestore[]
) => {
  const sections = (() => {
    try {
      const parsed = JSON.parse(editor.serialize());
      const list = parsed?.sections ?? parsed?.sec;
      if (!Array.isArray(list)) return undefined;
      return list.map((section: any) => section?.blocks ?? section?.b ?? []);
    } catch {
      return undefined;
    }
  })();
  if (!sections) return;
  const readStyle = (block: any): string | undefined =>
    block?.paragraphFormat?.styleName ?? block?.pf?.stn;
  const readText = (block: any): string =>
    ((block?.inlines ?? block?.i ?? []) as any[])
      .map((run) => run?.text ?? run?.tlp ?? '')
      .join('');
  const identify = (block: any) => paragraphIdentityText(readText(block));
  for (const restore of restores) {
    const [sectionIndex, blockIndex] = restore.anchor.split(';').map(Number);
    const atAnchor = sections[sectionIndex]?.[blockIndex];
    let target: { section: number; block: number } | undefined;
    if (atAnchor && identify(atAnchor) === restore.text)
      target = { section: sectionIndex, block: blockIndex };
    else {
      // The anchor moved. Fall back to the one paragraph that still reads the
      // same; ambiguity means leave it alone.
      const matches: Array<{ section: number; block: number }> = [];
      sections.forEach((blocks: any[], section: number) =>
        blocks.forEach((block: any, index: number) => {
          if (block?.rows ?? block?.r) return;
          if (identify(block) === restore.text)
            matches.push({ section, block: index });
        })
      );
      if (matches.length === 1) target = matches[0];
    }
    if (!target) continue;
    const block = sections[target.section]?.[target.block];
    if (readStyle(block) === restore.styleName) continue;
    const anchor = `${target.section};${target.block}`;
    try {
      editor.selection?.select?.(`${anchor};0`, `${anchor};0`);
      (editor.editor as any)?.applyStyle?.(restore.styleName);
    } catch {
      // Content still resolves consistently if one style restore fails.
    }
  }
};

export function rebindRevisionGroups(editor: LiveEditor): number {
  const partitions = new Map<
    string,
    {
      changeSetId: string;
      group: string;
      revisions: LiveRevision[];
      restoreCandidates: AppearanceRestore[][];
      styleCandidates: ParagraphStyleRestore[][];
    }
  >();
  for (const revision of snapshotRevisions(editor)) {
    if ((revision as any).robinGroupBound) continue;
    const tag = parseRevisionGroupTag(revision.customData);
    if (!tag) continue;
    const key = `${tag.changeSetId}\u0000${tag.group}`;
    const partition = partitions.get(key);
    if (partition) {
      partition.revisions.push(revision);
      if (tag.appearanceRestores)
        partition.restoreCandidates.push(tag.appearanceRestores);
      if (tag.paragraphStyles)
        partition.styleCandidates.push(tag.paragraphStyles);
    } else {
      partitions.set(key, {
        changeSetId: tag.changeSetId,
        group: tag.group,
        revisions: [revision],
        restoreCandidates: tag.appearanceRestores
          ? [tag.appearanceRestores]
          : [],
        styleCandidates: tag.paragraphStyles ? [tag.paragraphStyles] : []
      });
    }
  }
  let bound = 0;
  partitions.forEach((partition) => {
    const payloads = new Map(
      partition.restoreCandidates.map((restores) => [
        JSON.stringify(restores),
        restores
      ])
    );
    const restores =
      payloads.size === 1 ? [...payloads.values()][0] : undefined;
    // Same agreement rule as the appearance payload: every member of a group
    // carries the same snapshot, so disagreement means a stale or mixed tag and
    // the safe reading is to restore nothing.
    const stylePayloads = new Map(
      partition.styleCandidates.map((styles) => [
        JSON.stringify(styles),
        styles
      ])
    );
    const styles =
      stylePayloads.size === 1 ? [...stylePayloads.values()][0] : undefined;
    groupRevisionsAtomic(
      editor,
      partition.revisions,
      partition.changeSetId,
      partition.group,
      restores,
      styles
    );
    bound += partition.revisions.length;
  });
  return bound;
}
