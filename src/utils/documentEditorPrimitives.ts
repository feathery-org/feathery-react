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

// Syncfusion does not track expression changes inside control tags. This
// inverse follows the required binding's presence across reject and history.
export interface ExpressionRestore {
  name: string;
  fromTag: string;
  toTag: string;
  requires: string;
}

/** A calculated value changed by the reviewed edits in the same card. */
export interface DerivedValueChange {
  name: string;
  beforeText: string;
  afterText: string;
}

/** How much paragraph text identifies a restore. Long enough to be unique. */
const PARAGRAPH_IDENTITY_LIMIT = 200;

export const paragraphIdentityText = (text: string): string =>
  text.slice(0, PARAGRAPH_IDENTITY_LIMIT);

let programmaticSelectionDepth = 0;
// Prevent internal card-resolution selections from triggering binding commits.
export function isProgrammaticSelection(): boolean {
  return programmaticSelectionDepth > 0;
}
export function withProgrammaticSelection<T>(run: () => T): T {
  programmaticSelectionDepth += 1;
  try {
    return run();
  } finally {
    programmaticSelectionDepth -= 1;
  }
}

// Formatting setters need Syncfusion to refresh its real selected-cell cache.
export function withLiveSelection<T>(editor: LiveEditor, run: () => T): T {
  const selection: any = (editor as any).selection;
  const prior = selection?.isModifyingSelectionInternally;
  if (selection) selection.isModifyingSelectionInternally = false;
  try {
    return run();
  } finally {
    if (selection) selection.isModifyingSelectionInternally = prior ?? false;
  }
}

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

/** The serialized shape of a deferred bookmark clamp; see BookmarkClampIntent. */
interface PersistedBookmarkClamp {
  name: string;
  receipt: string;
}

interface RevisionGroupTag {
  changeSetId: string;
  group: string;
  reviewBundleId?: string;
  changeSetIds?: string[];
  resourceKeys?: string[];
  sequence?: number;
  coalesce?: boolean;
  appearanceRestores?: AppearanceRestore[];
  paragraphStyles?: ParagraphStyleRestore[];
  bookmarkClamps?: PersistedBookmarkClamp[];
  expressionRestores?: ExpressionRestore[];
  derivedChanges?: DerivedValueChange[];
}

export interface RevisionBundleTag {
  reviewBundleId?: string;
  changeSetIds?: string[];
  resourceKeys?: string[];
  sequence?: number;
  coalesce?: boolean;
}

export function revisionGroupTag(
  changeSetId: string,
  group: string,
  appearanceRestores?: AppearanceRestore[],
  paragraphStyles?: ParagraphStyleRestore[],
  bookmarkClamps?: PersistedBookmarkClamp[],
  expressionRestores?: ExpressionRestore[],
  derivedChanges?: DerivedValueChange[],
  bundle?: RevisionBundleTag
): string {
  return JSON.stringify({
    v: REVISION_GROUP_TAG_VERSION,
    source: 'robin',
    changeSetId,
    group,
    ...(bundle?.reviewBundleId
      ? { reviewBundleId: bundle.reviewBundleId }
      : {}),
    ...(bundle?.changeSetIds?.length
      ? { changeSetIds: [...new Set(bundle.changeSetIds)] }
      : {}),
    ...(bundle?.resourceKeys?.length
      ? { resourceKeys: [...new Set(bundle.resourceKeys)].sort() }
      : {}),
    ...(Number.isInteger(bundle?.sequence)
      ? { sequence: bundle?.sequence }
      : {}),
    ...(bundle?.coalesce ? { coalesce: true } : {}),
    ...(appearanceRestores?.length ? { appearanceRestores } : {}),
    ...(paragraphStyles?.length ? { paragraphStyles } : {}),
    ...(bookmarkClamps?.length ? { bookmarkClamps } : {}),
    ...(expressionRestores?.length ? { expressionRestores } : {}),
    ...(derivedChanges?.length ? { derivedChanges } : {})
  });
}

function parseDerivedValueChanges(
  value: unknown
): DerivedValueChange[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const changes: DerivedValueChange[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return undefined;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.name !== 'string' ||
      !raw.name ||
      typeof raw.beforeText !== 'string' ||
      typeof raw.afterText !== 'string'
    )
      return undefined;
    changes.push({
      name: raw.name,
      beforeText: raw.beforeText,
      afterText: raw.afterText
    });
  }
  return changes;
}

function parsePersistedExpressionRestores(
  value: unknown
): ExpressionRestore[] | null {
  if (!Array.isArray(value)) return null;
  const restores: ExpressionRestore[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    const fields = ['name', 'fromTag', 'toTag', 'requires'] as const;
    if (fields.some((field) => typeof raw[field] !== 'string' || !raw[field]))
      return null;
    restores.push({
      name: String(raw.name),
      fromTag: String(raw.fromTag),
      toTag: String(raw.toTag),
      requires: String(raw.requires)
    });
  }
  return restores.length ? restores : null;
}

function parsePersistedBookmarkClamps(
  value: unknown
): PersistedBookmarkClamp[] | null {
  if (!Array.isArray(value)) return null;
  const clamps: PersistedBookmarkClamp[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const clamp = item as Record<string, unknown>;
    if (typeof clamp.name !== 'string' || !clamp.name) return null;
    if (typeof clamp.receipt !== 'string') return null;
    clamps.push({ name: clamp.name, receipt: clamp.receipt });
  }
  return clamps.length ? clamps : null;
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
      const bookmarkClamps = parsePersistedBookmarkClamps(
        parsed.bookmarkClamps
      );
      const expressionRestores = parsePersistedExpressionRestores(
        parsed.expressionRestores
      );
      const derivedChanges = parseDerivedValueChanges(parsed.derivedChanges);
      const reviewBundleId =
        typeof parsed.reviewBundleId === 'string' &&
        parsed.reviewBundleId.trim()
          ? parsed.reviewBundleId.trim()
          : undefined;
      const changeSetIds: string[] | undefined = Array.isArray(
        parsed.changeSetIds
      )
        ? [
            ...new Set(
              (parsed.changeSetIds as unknown[]).filter(
                (id: unknown): id is string =>
                  typeof id === 'string' && !!id.trim()
              )
            )
          ]
        : undefined;
      const resourceKeys: string[] | undefined = Array.isArray(
        parsed.resourceKeys
      )
        ? [
            ...new Set(
              (parsed.resourceKeys as unknown[]).filter(
                (key: unknown): key is string =>
                  typeof key === 'string' && !!key.trim()
              )
            )
          ].sort()
        : undefined;
      const sequence = Number.isInteger(parsed.sequence)
        ? Number(parsed.sequence)
        : undefined;
      const coalesce = parsed.coalesce === true;
      return {
        changeSetId: parsed.changeSetId,
        group: parsed.group,
        ...(reviewBundleId ? { reviewBundleId } : {}),
        ...(changeSetIds?.length ? { changeSetIds } : {}),
        ...(resourceKeys?.length ? { resourceKeys } : {}),
        ...(sequence !== undefined ? { sequence } : {}),
        ...(coalesce ? { coalesce: true } : {}),
        ...(appearanceRestores ? { appearanceRestores } : {}),
        ...(paragraphStyles ? { paragraphStyles } : {}),
        ...(bookmarkClamps ? { bookmarkClamps } : {}),
        ...(expressionRestores ? { expressionRestores } : {}),
        ...(derivedChanges ? { derivedChanges } : {})
      };
    }
  } catch {
    // Foreign customData stays outside assistant grouping.
  }
  return undefined;
}

/**
 * User typing is never tracked. Assist turns SyncFusion's global
 * `enableTrackChanges` on only inside a synchronous `applyDocumentEdits`
 * batch; this is the steady state the host starts from and the batch must
 * leave behind. Pass the wrapping DocumentEditorContainer when you have it:
 * its flag can drift from the inner editor on `documentChange` and would
 * otherwise push tracking back on.
 */
export function disableUserTrackChanges(
  // Only the track-changes flag is touched, so accept any editor-like carrying
  // it (LiveEditor satisfies this, as does the SyncfusionEditorLike used by the
  // keystroke guard).
  editor: { enableTrackChanges: boolean },
  container?: { enableTrackChanges?: boolean } | null
): void {
  editor.enableTrackChanges = false;
  if (container && container !== editor) container.enableTrackChanges = false;
}

const wrappingDocumentEditorContainers = new WeakMap<
  object,
  { enableTrackChanges?: boolean }
>();

/** Remember the outer SyncFusion container that owns one live editor. */
export function registerWrappingDocumentEditorContainer(
  editor: object,
  container: { enableTrackChanges?: boolean }
): void {
  wrappingDocumentEditorContainers.set(editor, container);
}

/** The outer container whose track-changes flag mirrors this editor's flag. */
export function wrappingDocumentEditorContainer(
  editor: object
): { enableTrackChanges?: boolean } | undefined {
  return wrappingDocumentEditorContainers.get(editor);
}

const REVISION_ISOLATION_INSTALLED = '__robinRevisionGroupIsolation';

// The identity half of a tag, memoized by its exact customData string. The
// bulk-resolve loop and the isolation hook re-read every revision's tag per
// iteration; the appearance/style payloads they never need are the expensive
// part of the parse, so only {changeSetId, group} is cached (the full parse
// stays fresh for the binding paths that consume the payloads).
type RevisionTagIdentity = {
  changeSetId: string;
  group: string;
  reviewBundleId?: string;
};
const TAG_IDENTITY_MEMO = new Map<string, RevisionTagIdentity | null>();
const revisionTagIdentity = (
  customData: unknown
): RevisionTagIdentity | null => {
  if (typeof customData !== 'string' || !customData.trim()) return null;
  let identity = TAG_IDENTITY_MEMO.get(customData);
  if (identity === undefined) {
    const tag = parseRevisionGroupTag(customData);
    identity = tag
      ? {
          changeSetId: tag.changeSetId,
          group: tag.group,
          ...(tag.reviewBundleId ? { reviewBundleId: tag.reviewBundleId } : {})
        }
      : null;
    // Bounded: tags accumulate across documents in one long editor session.
    if (TAG_IDENTITY_MEMO.size > 10000) TAG_IDENTITY_MEMO.clear();
    TAG_IDENTITY_MEMO.set(customData, identity);
  }
  return identity;
};

const revisionTagKey = (customData: unknown): string => {
  const identity = revisionTagIdentity(customData);
  return identity
    ? identity.reviewBundleId && parseRevisionGroupTag(customData)?.coalesce
      ? `bundle ${identity.reviewBundleId}`
      : `${identity.changeSetId} ${identity.group}`
    : '';
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
  // The complementary invariant: a split must not fall OUT of its group. When
  // untracked user typing lands inside a pending revision, SyncFusion splits
  // it — but stock insertRevision stamps the new (split-off) revision with the
  // CURRENT global revisionSettings.customData, which outside an assistant
  // batch is the host's (usually none). The split half then surfaced in the
  // rail as a brand-new untagged author card, reading as "the user's edit
  // became a tracked change". Copy the source revision's tag onto any split
  // product that lacks one; revisions that were never tagged stay untouched.
  if (typeof module.updateRevisionForSpittedTextElement === 'function') {
    const originalSplit =
      module.updateRevisionForSpittedTextElement.bind(module);
    module.updateRevisionForSpittedTextElement = (
      inline: any,
      splittedSpan: any,
      currentItem: any
    ): any => {
      let sourceTag: unknown;
      for (let index = 0; index < (inline?.revisionLength ?? 0); index++) {
        const revision = inline.getRevision?.(index);
        if (revision?.customData != null) {
          sourceTag = revision.customData;
          break;
        }
      }
      const result = originalSplit(inline, splittedSpan, currentItem);
      if (sourceTag != null) {
        for (const half of [inline, splittedSpan]) {
          const revisions: any[] = half?.getAllRevision?.() ?? [];
          for (const revision of revisions)
            if (revision && revision.customData == null)
              revision.customData = sourceTag;
        }
      }
      return result;
    };
  }
}

const CONTENT_CONTROL_DELETION_INSTALLED =
  '__robinTrackedContentControlDeletion';

// Vendored override, 34.1.31: handleDeleteTracking splices a content control
// out untracked where a bookmark gets a Deletion revision, so a tracked row
// delete destroys the row's binding tags and reject cannot restore them
export function installTrackedContentControlDeletion(editor: LiveEditor): void {
  const module: any = (editor as any).editorModule ?? editor.editor;
  if (!module || typeof module.handleDeleteTracking !== 'function') return;
  if (module[CONTENT_CONTROL_DELETION_INSTALLED]) return;
  module[CONTENT_CONTROL_DELETION_INSTALLED] = true;
  const original = module.handleDeleteTracking.bind(module);
  // Same predicate the SDK uses to enter its marker branch with tracking on
  const isTrackedDeletion = (elementBox: any): boolean => {
    if (!module.owner?.enableTrackChanges) return false;
    const history = module.editorHistory;
    const isRedoingRowTrack =
      !!elementBox.paragraph?.isInsideTable &&
      !!history?.isRedoing &&
      history.currentBaseHistoryInfo?.action === 'RemoveRowTrack';
    return (
      module.canHandleDeletion() || !module.skipTracking() || isRedoingRowTrack
    );
  };
  // A row deletion already owns its control markers. A second marker revision
  // becomes an empty-range revision when the row resolves.
  const rowGovernsThisDeletion = (elementBox: any): boolean => {
    const row = elementBox?.line?.paragraph?.associatedCell?.ownerRow;
    if (!row) return false;
    if (rowIsPendingDeleted(row)) return true;
    // The row's Deletion may not be on its rowFormat yet: `trackRowDeletion`
    // stamps this action on the history entry as it starts.
    return (
      module.editorHistory?.currentBaseHistoryInfo?.action === 'RemoveRowTrack'
    );
  };
  module.handleDeleteTracking = (elementBox: any, ...rest: any[]): any => {
    const isContentControl =
      typeof elementBox?.contentControlWidgetType === 'string' &&
      !!elementBox.contentControlProperties;
    if (!isContentControl || !isTrackedDeletion(elementBox))
      return original(elementBox, ...rest);
    if (module.skipTableElements || rowGovernsThisDeletion(elementBox))
      return undefined;
    if (!module.checkToCombineRevisionsInSides(elementBox, 'Deletion'))
      module.insertRevision(elementBox, 'Deletion');
    module.updateLastDeletedRevision(elementBox);
    return undefined;
  };
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

// A card shares one tracking identity, so its members use the SDK group path.
const resolveSingleRevision = (
  resolvers: NativeResolvers,
  isAccept: boolean,
  asGroupMember = false
): void => {
  if (resolvers.single) resolvers.single(isAccept, asGroupMember);
  else (isAccept ? resolvers.accept : resolvers.reject)?.();
};

// Bookmark clamps are deferred until the deleting card is accepted.
export interface BookmarkClampIntent {
  name: string;
  receipt: string;
}

const revisionTypeOf = (revision: unknown): string =>
  String((revision as { revisionType?: unknown })?.revisionType ?? '');

/** Does this row widget carry a pending Deletion revision on its rowFormat? */
const rowIsPendingDeleted = (row: any): boolean => {
  const format = row?.rowFormat;
  if (!format) return false;
  const count =
    typeof format.revisionLength === 'number'
      ? format.revisionLength
      : Array.isArray(format.revisions)
      ? format.revisions.length
      : 0;
  for (let index = 0; index < count; index++) {
    const revision = format.revisions?.[index] ?? format.getRevision?.(index);
    if (revisionTypeOf(revision) === 'Deletion') return true;
  }
  return false;
};

const bookmarkRowOf = (element: any): any =>
  element?.line?.paragraph?.associatedCell?.ownerRow;

/** Is this widget still parented into the live document tree? */
const widgetTreeAttached = (widget: any): boolean => {
  if (!widget) return false;
  const seen = new Set<any>();
  let current = widget;
  while (current) {
    if (seen.has(current)) return false;
    seen.add(current);
    // A text frame hangs off its shape element's line, not off a container
    // widget (its indexInOwner reads -1): continue from the anchoring paragraph.
    if (current.containerShape) {
      current = current.containerShape.line?.paragraph;
      if (!current) return false;
      continue;
    }
    // A header or footer is a root (indexInOwner -1 by design), and its
    // content is attached: a revision in a header is not a leak.
    if (typeof current.headerFooterType === 'string') return true;
    if (current.indexInOwner === -1) return false;
    current = current.containerWidget;
  }
  return true;
};

const firstParagraphIn = (cell: any, fromEnd: boolean): any => {
  const blocks: any[] = Array.isArray(cell?.childWidgets)
    ? cell.childWidgets
    : [];
  const ordered = fromEnd ? [...blocks].reverse() : blocks;
  return ordered.find((widget) => widget && widget.paragraphFormat);
};

// Resolve target widgets before row deletion, then move them after the SDK has
// finished resolving the group.
interface PlannedBookmarkClampMove {
  name: string;
  receipt: string;
  element: any;
  isStart: boolean;
  targetLine: any;
  targetParagraph: any;
  // The SDK may detach the surviving end while removing its partner.
  keeper: { element: any; line: any; index: number };
}

// Resolve each torn bookmark against the current rows of its own table.
export function planBookmarkClampMoves(
  editor: LiveEditor,
  intents: BookmarkClampIntent[]
): PlannedBookmarkClampMove[] {
  const moves: PlannedBookmarkClampMove[] = [];
  const bookmarks = (editor as any).documentHelper?.bookmarks;
  if (!bookmarks?.get) return moves;
  for (const intent of intents) {
    const opening = bookmarks.get(intent.name);
    const closing = opening?.reference;
    if (!opening?.line || !closing?.line) continue;
    const ends = [
      { element: opening, isStart: true },
      { element: closing, isStart: false }
    ];
    const doomed = ends.filter((end) => {
      const row = bookmarkRowOf(end.element);
      return !!row && rowIsPendingDeleted(row);
    });
    // Both ends going means the whole bookmark goes with its rows; neither
    // going means there is nothing to clamp. Only a TORN bookmark moves.
    if (doomed.length !== 1) continue;
    const torn = doomed[0];
    const row = bookmarkRowOf(torn.element);
    const table = row?.ownerTable;
    const rows: any[] = Array.isArray(table?.childWidgets)
      ? table.childWidgets
      : [];
    const at = rows.indexOf(row);
    if (at < 0) continue;
    // Walk toward the surviving end: a torn start moves DOWN onto the first
    // surviving row, a torn end moves UP.
    const step = torn.isStart ? 1 : -1;
    let landingRow: any;
    for (
      let index = at + step;
      index >= 0 && index < rows.length;
      index += step
    )
      if (!rowIsPendingDeleted(rows[index])) {
        landingRow = rows[index];
        break;
      }
    if (!landingRow) continue;
    const cells: any[] = Array.isArray(landingRow.childWidgets)
      ? landingRow.childWidgets
      : [];
    const cell = torn.isStart ? cells[0] : cells[cells.length - 1];
    const paragraph = firstParagraphIn(cell, !torn.isStart);
    const lines: any[] = Array.isArray(paragraph?.childWidgets)
      ? paragraph.childWidgets
      : [];
    if (!lines.length) continue;
    const target = torn.isStart ? lines[0] : lines[lines.length - 1];
    if (!Array.isArray(target?.children)) continue;
    const keeperEnd = ends.find((end) => end !== torn);
    const keeperLine = keeperEnd?.element?.line;
    if (!keeperEnd || !Array.isArray(keeperLine?.children)) continue;
    moves.push({
      name: intent.name,
      receipt: intent.receipt,
      element: torn.element,
      isStart: torn.isStart,
      targetLine: target,
      targetParagraph: paragraph,
      keeper: {
        element: keeperEnd.element,
        line: keeperLine,
        index: keeperLine.children.indexOf(keeperEnd.element)
      }
    });
  }
  return moves;
}

// Reattach planned ends after the deleting group has fully resolved.
export function applyBookmarkClampMoves(
  editor: LiveEditor,
  moves: PlannedBookmarkClampMove[]
): string[] {
  const executed: string[] = [];
  const bookmarks = (editor as any).documentHelper?.bookmarks;
  for (const move of moves) {
    const { element, targetLine, targetParagraph } = move;
    if (!element || !Array.isArray(targetLine?.children)) continue;
    // The move is owed only when the deletion actually took the end's row: a
    // rejected (or partially rejected) group leaves the row - and the end -
    // standing, and a bookmark that survived in place must not be narrowed.
    if (widgetTreeAttached(element.line?.paragraph)) continue;
    // Detach from wherever the resolution left it (often already detached
    // because its row went), then land on the survivor.
    const from = element.line;
    if (from && Array.isArray(from.children)) {
      const index = from.children.indexOf(element);
      if (index >= 0) from.children.splice(index, 1);
    }
    if (targetLine.children.indexOf(element) < 0) {
      if (move.isStart) targetLine.children.unshift(element);
      else targetLine.children.push(element);
    }
    element.line = targetLine;
    // Put the surviving end back where it lived if the engine's half-bookmark
    // cleanup stripped it alongside the deleted row.
    const keeper = move.keeper;
    if (
      keeper?.element &&
      Array.isArray(keeper.line?.children) &&
      keeper.line.children.indexOf(keeper.element) < 0
    ) {
      const at = Math.min(
        Math.max(keeper.index, 0),
        keeper.line.children.length
      );
      keeper.line.children.splice(at, 0, keeper.element);
      keeper.element.line = keeper.line;
    }
    // Resolving a deletion that held one end can drop the bookmark from the
    // engine's dictionary; both elements exist again, so put the entry back.
    try {
      const opening = move.isStart ? element : element.reference;
      if (
        opening &&
        bookmarks?.add &&
        bookmarks?.containsKey &&
        !bookmarks.containsKey(move.name)
      )
        bookmarks.add(move.name, opening);
    } catch {
      // The marks are in the document either way; the dictionary is a cache.
    }
    // A relayout under a suspended layout is a no-op, so lift it for the move.
    const live = editor as any;
    const layoutWasOn = editor.enableLayout === true;
    if (!layoutWasOn) live.setProperties?.({ enableLayout: true }, true);
    try {
      const layout = live.documentHelper?.layout;
      if (from?.paragraph && from.paragraph !== targetParagraph)
        layout?.reLayoutParagraph?.(from.paragraph, 0, 0);
      layout?.reLayoutParagraph?.(targetParagraph, 0, 0);
    } catch {
      // Layout is cosmetic here; the serialized document already holds the move.
    } finally {
      if (!layoutWasOn) live.setProperties?.({ enableLayout: false }, true);
    }
    executed.push(move.receipt);
  }
  return executed;
}

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

const EXPRESSION_LEDGER = '__robinExpressionLedger';
const EXPRESSION_SWEEP_INSTALLED = '__robinExpressionSweepInstalled';

interface ExpressionLedgerEntry {
  groupKey: string;
  restore: ExpressionRestore;
}

// The ledger outlives revision metadata so reject and history can restore tags.
const expressionLedger = (editor: LiveEditor): ExpressionLedgerEntry[] =>
  ((editor as any)[EXPRESSION_LEDGER] ??= []);

const liveContentControls = (editor: LiveEditor): any[] => {
  const collection = (editor as any).documentHelper?.contentControlCollection;
  return Array.isArray(collection) ? collection : [];
};

// Serialized SFDT excludes detached controls retained by the live collection.
const bindingIsInDocument = (editor: LiveEditor, name: string): boolean => {
  const serialized = editor.serialize();
  return (
    serialized.includes(`name=${name}|`) ||
    serialized.includes(`name=${name}]]`)
  );
};

// Make every expression rewrite agree with the binding currently in the SFDT.
export function settleExpressionRewrites(editor: LiveEditor): void {
  const ledger = expressionLedger(editor);
  if (!ledger.length) return;
  const controls = liveContentControls(editor);
  if (!controls.length) return;
  const presence = new Map<string, boolean>();
  for (const { restore } of ledger) {
    let present = presence.get(restore.requires);
    if (present === undefined) {
      present = bindingIsInDocument(editor, restore.requires);
      presence.set(restore.requires, present);
    }
    const wanted = present ? restore.toTag : restore.fromTag;
    const stale = present ? restore.fromTag : restore.toTag;
    for (const control of controls) {
      const properties = control?.contentControlProperties;
      if (!properties || String(properties.tag ?? '') !== stale) continue;
      properties.tag = wanted;
    }
  }
}

// Undo and redo bypass group settlement, so they run the same idempotent sweep.
function installExpressionRewriteSweep(editor: LiveEditor): void {
  const history: any =
    (editor as any).editorHistoryModule ?? (editor as any).editorHistory;
  if (!history || history[EXPRESSION_SWEEP_INSTALLED]) return;
  history[EXPRESSION_SWEEP_INSTALLED] = true;
  for (const step of ['undo', 'redo']) {
    const original = history[step];
    if (typeof original !== 'function') continue;
    history[step] = (...args: any[]) => {
      const result = original.apply(history, args);
      try {
        settleExpressionRewrites(editor);
      } catch {
        // A failed sweep leaves the expression alone; it never fails the undo.
      }
      return result;
    };
  }
}

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
  paragraphStyles?: ParagraphStyleRestore[],
  bookmarkClamps?: BookmarkClampIntent[],
  expressionRestores?: ExpressionRestore[]
): void {
  if (!group.length) return;
  installAtomicRevisionCollectionResolution(editor);
  const members = group.map(captureNativeResolvers);
  const state = { resolved: false, restored: false, settled: false };
  /**
   * The deferred bookmark clamps this group promised, executed exactly when
   * the deletion becomes real - in two phases around the accept. PLAN on the
   * FIRST accept-resolution of the group, before any member resolves, while
   * the doomed rows (and the torn ends inside them) are still present to read.
   * APPLY at settlement, after every member has resolved, because moving a
   * bookmark element mid-resolution makes the engine mint a stray empty-range
   * revision that acceptAll then spins on. A reject never plans, and the apply
   * itself skips any end whose row survived, so rejecting the card restores
   * rows and bookmark alike; an undo revival re-arms the plan, which is safe
   * because planning self-resolves and a bookmark already sitting on surviving
   * rows plans nothing.
   */
  const clampState = {
    planned: false,
    moves: [] as ReturnType<typeof planBookmarkClampMoves>
  };
  const planBookmarkClamps = () => {
    if (clampState.planned || !bookmarkClamps?.length) return;
    clampState.planned = true;
    try {
      clampState.moves = planBookmarkClampMoves(editor, bookmarkClamps);
    } catch {
      // The accept must still resolve; a failed clamp loses only the narrowing.
    }
  };
  const applyBookmarkClamps = () => {
    if (!clampState.moves.length) return;
    const moves = clampState.moves;
    clampState.moves = [];
    try {
      applyBookmarkClampMoves(editor, moves);
    } catch {
      // The accept already resolved; a failed clamp loses only the narrowing.
    }
  };
  const resolvedAlone = new Set<number>();
  const acceptedAlone = new Set<number>();
  // This binding's identity. A group is finished when the document holds none
  // of its revisions - the only reading that survives SyncFusion dropping a
  // member as a side effect of resolving its neighbour, which a count of
  // resolve calls does not.
  const token = {};
  const groupKey = `${changeSetId ?? ''}\u0000${groupId ?? ''}`;
  if (expressionRestores?.length) {
    // Re-binding the same card (a reload, an undo revival) replaces its entries
    // rather than stacking a second copy of the same rewrite.
    const outstanding = expressionLedger(editor);
    for (let index = outstanding.length - 1; index >= 0; index--)
      if (outstanding[index].groupKey === groupKey)
        outstanding.splice(index, 1);
    for (const restore of expressionRestores)
      outstanding.push({ groupKey, restore });
    installExpressionRewriteSweep(editor);
  }
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
    try {
      // Asks the document, not the outcome: see settleExpressionRewrites.
      settleExpressionRewrites(editor);
    } catch {
      // Content still resolves consistently if an expression restore fails.
    }
    if (acceptedAlone.size > 0) applyBookmarkClamps();
  };
  const resolveAll = (isAccept: boolean) =>
    withProgrammaticSelection(() => resolveAllInner(isAccept));
  const resolveAllInner = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    const touchedTables = tablesTouchedByRevisions(group);
    if (isAccept) planBookmarkClamps();
    // Internal selection moves (see resolveRevisionsAsOneUndo).
    const selectionForFlag: any = (editor as any).selection ?? null;
    const priorFlag = selectionForFlag?.isModifyingSelectionInternally;
    if (selectionForFlag)
      selectionForFlag.isModifyingSelectionInternally = true;
    const order = [
      ...members
        .map((_, index) => index)
        .filter((index) => revisionSpansRow(group[index])),
      ...members
        .map((_, index) => index)
        .filter((index) => !revisionSpansRow(group[index]))
    ];
    for (const index of order) {
      if (resolvedAlone.has(index)) continue;
      if (
        members[index].single &&
        typeof group[index].getRange === 'function' &&
        revisionIsUnresolvable(group[index])
      ) {
        purgeUnresolvableRevisions(editor);
        continue;
      }
      if (isAccept) acceptedAlone.add(index);
      try {
        resolveSingleRevision(members[index], isAccept);
      } catch {
        // A later member can become stale after the first resolves.
      }
    }
    if (selectionForFlag)
      selectionForFlag.isModifyingSelectionInternally = priorFlag ?? false;
    settleIfFinished();
    if (members.length > 1) invalidateDocumentLayout(editor);
    recomputeDerivedValuesAfterResolve(editor, touchedTables);
  };
  group.forEach((revision, index) => {
    if (changeSetId) (revision as any).robinChangeSetId = changeSetId;
    if (groupId) (revision as any).robinGroupId = groupId;
    (revision as any).robinGroupBound = true;
    (revision as any).robinGroupToken = token;
    (revision as any).robinResolveSelf = (
      isAccept: boolean,
      asGroupMember = false
    ) => {
      if (state.resolved || resolvedAlone.has(index)) return;
      // The non-cascading path the review rail resolves every card through:
      // per-chip, per-card and rail-wide all arrive here, member by member.
      resolvedAlone.add(index);
      if (isAccept) {
        acceptedAlone.add(index);
        planBookmarkClamps();
      }
      resolveSingleRevision(members[index], isAccept, asGroupMember);
      settleIfFinished();
    };
    (revision as any).robinReviveSelf = () => {
      state.resolved = false;
      state.settled = false;
      clampState.planned = false;
      clampState.moves = [];
      resolvedAlone.delete(index);
      acceptedAlone.delete(index);
    };
    revision.accept = () => resolveAll(true);
    revision.reject = () => resolveAll(false);
  });
  bindAppearanceTargets();
}

const ATOMIC_COLLECTION_RESOLUTION_INSTALLED =
  '__robinAtomicCollectionResolutionInstalled';

/**
 * Keep Syncfusion's collection-wide actions on the same non-cascading path as
 * Robin's review rail.
 *
 * Once a revision is group-bound, its public accept/reject method resolves the
 * whole logical group. Syncfusion's native acceptAll/rejectAll loops assume one
 * public call removes exactly one revision; resolving several at once leaves
 * that loop on a stale member and it never terminates. Resolve the live group
 * inventory directly instead, which also preserves one undo unit.
 */
function installAtomicRevisionCollectionResolution(editor: LiveEditor): void {
  const collection = editor.revisions as LiveRevisionCollection | undefined;
  if (!collection || collection[ATOMIC_COLLECTION_RESOLUTION_INSTALLED]) return;
  collection[ATOMIC_COLLECTION_RESOLUTION_INSTALLED] = true;
  const nativeAcceptAll = collection.acceptAll?.bind(collection);
  const nativeRejectAll = collection.rejectAll?.bind(collection);
  collection.acceptAll = () => {
    const groups = listRevisionGroups(editor);
    if (groups.length) resolveLiveRevisionGroupsAsOneUndo(editor, groups, true);
    nativeAcceptAll?.();
  };
  collection.rejectAll = () => {
    const groups = listRevisionGroups(editor);
    if (groups.length)
      resolveLiveRevisionGroupsAsOneUndo(editor, groups, false);
    nativeRejectAll?.();
  };
}

export function resolveRevisionIndividually(
  revision: LiveRevision,
  isAccept: boolean,
  asGroupMember = false
): void {
  const resolveSelf = (revision as any).robinResolveSelf;
  if (typeof resolveSelf === 'function') resolveSelf(isAccept, asGroupMember);
  else
    resolveSingleRevision(
      captureNativeResolvers(revision),
      isAccept,
      asGroupMember
    );
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

// Syncfusion cannot deregister a revision whose range is already empty.
export const revisionRangeLength = (revision: LiveRevision): number => {
  try {
    const range =
      typeof revision.getRange === 'function' ? revision.getRange() : [];
    return Array.isArray(range) ? range.length : 0;
  } catch {
    return -1;
  }
};

/**
 * Whether one item of a revision's range is still in the document: a text box
 * or control mark still on its line, in a paragraph still in the tree; a
 * paragraph mark or row format whose owner is still in the tree.
 */
const rangeItemAttached = (item: any): boolean => {
  if (!item) return false;
  const owner = item.ownerBase;
  // Adapter/test revisions can expose an opaque range token rather than an EJ2
  // widget. There is no attachment claim to disprove in that shape, so let the
  // revision's own resolver decide whether it can move.
  if (!owner && !item.line) return true;
  if (owner && !item.line) return widgetTreeAttached(owner);
  const line = item.line;
  if (!line || !Array.isArray(line.children)) return false;
  if (!line.children.includes(item)) return false;
  return widgetTreeAttached(line.paragraph);
};

// A retained range of detached widgets is as unsafe as an empty range.
export const revisionIsUnresolvable = (revision: LiveRevision): boolean => {
  const length = revisionRangeLength(revision);
  if (length === 0) return true;
  if (length < 0) return false;
  try {
    const range =
      typeof revision.getRange === 'function' ? revision.getRange() : [];
    return range.every((item: any) => !rangeItemAttached(item));
  } catch {
    return false;
  }
};

// Row revisions are structural containers for revisions inside their cells.
export const revisionSpansRow = (revision: LiveRevision): boolean => {
  try {
    const range =
      typeof revision.getRange === 'function' ? revision.getRange() : [];
    return (
      Array.isArray(range) &&
      range.some((item: any) => item?.constructor?.name === 'WRowFormat')
    );
  } catch {
    return false;
  }
};

// Resolve structural containers before the content they own.
export const containersFirst = <T extends LiveRevision>(
  revisions: T[]
): T[] => [
  ...revisions.filter(revisionSpansRow),
  ...revisions.filter((revision) => !revisionSpansRow(revision))
];

// SDK-created fragments inherit only the identity of a tagged same-author card.
export function adoptRevisionsIntoAuthorsCard(
  editor: LiveEditor,
  created: LiveRevision[]
): void {
  if (!created.length) return;
  const live = snapshotRevisions(editor);
  for (const revision of created) {
    if (parseRevisionGroupTag(revision.customData)) continue;
    const author = String(revision.author ?? '');
    const sibling = live.find(
      (candidate) =>
        candidate !== revision &&
        String(candidate.author ?? '') === author &&
        !!parseRevisionGroupTag(candidate.customData)
    );
    const tag = sibling ? parseRevisionGroupTag(sibling.customData) : undefined;
    // The identity only: the sibling's payload (appearance snapshots, clamps)
    // describes the sibling's own edits and must not be replayed twice.
    if (tag)
      revision.customData = revisionGroupTag(
        tag.changeSetId,
        tag.group,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          reviewBundleId: tag.reviewBundleId,
          changeSetIds: tag.changeSetIds,
          resourceKeys: tag.resourceKeys,
          sequence: tag.sequence,
          coalesce: tag.coalesce
        }
      );
  }
}

// Retire document-wide empty or detached revision leaks that the SDK cannot
// settle itself. Returns the retired objects for outcome accounting.
export function purgeUnresolvableRevisions(editor: LiveEditor): LiveRevision[] {
  const collection: any = (editor as any).revisions;
  const registry: any = (editor as any).documentHelper?.revisionsInternal;
  const purged: LiveRevision[] = [];
  for (const revision of snapshotRevisions(editor)) {
    if (!revisionIsUnresolvable(revision)) continue;
    // The SDK's own removal first: it also tears down the change-pane view.
    try {
      collection?.remove?.(revision);
    } catch {
      // The two arrays below are the registration that actually matters.
    }
    // `RevisionCollection.remove` splices only `changes` when the change pane
    // never rendered this revision, while `length` reads `revisions` - so a
    // host without that pane keeps counting a revision the SDK just removed.
    for (const key of ['revisions', 'changes']) {
      const list = collection?.[key];
      if (!Array.isArray(list)) continue;
      const at = list.indexOf(revision);
      if (at >= 0) list.splice(at, 1);
    }
    try {
      const id = revision.revisionID;
      if (id && registry?.containsKey?.(id)) registry.remove(id);
    } catch {
      // The id map is a lookup cache; the collection is the registration.
    }
    purged.push(revision);
  }
  return purged;
}

// Remains array-compatible while exposing members the SDK refused to move.
export interface RevisionResolveOutcome extends Array<LiveRevision> {
  unresolved: LiveRevision[];
}

const resolveOutcome = (
  resolved: LiveRevision[],
  unresolved: LiveRevision[]
): RevisionResolveOutcome =>
  Object.assign(resolved as RevisionResolveOutcome, { unresolved });

export function resolveRevisionsAsOneUndo(
  editor: LiveEditor,
  revisions: LiveRevision[],
  isAccept: boolean
): RevisionResolveOutcome {
  return withProgrammaticSelection(() =>
    resolveRevisionsAsOneUndoInner(editor, revisions, isAccept)
  );
}

function resolveRevisionsAsOneUndoInner(
  editor: LiveEditor,
  revisions: LiveRevision[],
  isAccept: boolean
): RevisionResolveOutcome {
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
  const resolved: LiveRevision[] = [];
  const attempted: LiveRevision[] = [];
  const touchedTables = tablesTouchedByRevisions(
    identities
      .map((identity) => lookupRevision(index, identity))
      .filter(Boolean) as LiveRevision[]
  );
  // The engine's own selection moves during a resolve are internal: with this
  // flag the SDK skips the selectionChange dispatch for them, so no listener
  // (commit triggers, adoption) runs in the middle of a resolve.
  const selectionForFlag: any = (editor as any).selection ?? null;
  const priorFlag = selectionForFlag?.isModifyingSelectionInternally;
  if (selectionForFlag) selectionForFlag.isModifyingSelectionInternally = true;
  try {
    const ordered = containersFirst(
      [...identities]
        .reverse()
        .map((identity) => lookupRevision(index, identity))
        .filter(Boolean) as LiveRevision[]
    );
    for (const revision of ordered) {
      // Retired by an earlier member's resolution (its row went): not an edit.
      if (revisionIsUnresolvable(revision)) {
        purgeUnresolvableRevisions(editor);
        continue;
      }
      attempted.push(revision);
      (revision as any).robinReviveSelf?.();
      try {
        resolveRevisionIndividually(revision, isAccept, false);
        resolved.push(revision);
      } catch {
        // A stale member does not stop the remaining unit.
      }
    }
  } finally {
    if (selectionForFlag)
      selectionForFlag.isModifyingSelectionInternally = priorFlag ?? false;
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping cannot undo a completed resolution.
      }
    }
  }
  // Before the document state is read back: an empty-range revision is not a
  // member this pass failed to move, it is a leak to retire (see the law on
  // `purgeUnresolvableRevisions`).
  const purged = new Set(purgeUnresolvableRevisions(editor));
  if (revisions.length > 1) invalidateDocumentLayout(editor);
  recomputeDerivedValuesAfterResolve(editor, touchedTables);
  // Same law as the group path, read the same way: what is still registered
  // after the pass did not move, whether it threw or refused in silence. This
  // list is one edit's worth here, so a chip that cannot resolve says so
  // instead of leaving the rail redrawing the same chip after every click.
  const live = new Set(liveRevisionsRaw(editor));
  return resolveOutcome(
    resolved.filter((revision) => !purged.has(revision)),
    attempted.filter((revision) => live.has(revision))
  );
}

export interface RevisionGroupIdentity {
  changeSetId: string;
  group: string;
  reviewBundleId?: string;
  untagged?: boolean;
}

/**
 * The outermost tables whose ROW STRUCTURE a set of revisions changes. Text
 * replacements inside a table do not affect banding and must not cause that
 * table to be restriped when the revision resolves.
 */
export function tablesTouchedByRevisions(revisions: LiveRevision[]): Set<any> {
  const tables = new Set<any>();
  for (const revision of revisions) {
    if (!revisionSpansRow(revision)) continue;
    let range: any[] = [];
    try {
      range =
        typeof revision.getRange === 'function'
          ? revision.getRange()
          : Array.isArray(revision.range)
          ? revision.range
          : [];
    } catch {
      range = [];
    }
    for (const item of range) {
      const table = outermostTableOf(item);
      if (table) tables.add(table);
    }
  }
  return tables;
}

const outermostTableOf = (item: any): any => {
  const owner = item?.ownerBase;
  let table: any = owner?.ownerTable ?? null;
  if (!table) {
    const paragraph = item?.line?.paragraph ?? owner ?? null;
    table = paragraph?.associatedCell?.ownerTable ?? null;
  }
  if (!table) return null;
  while (table.containerWidget?.ownerTable)
    table = table.containerWidget.ownerTable;
  const pieces =
    typeof table.getSplitWidgets === 'function'
      ? table.getSplitWidgets()
      : null;
  return pieces?.[0] ?? table;
};

/** The position of `widget` among a section's top-level blocks, or -1. */
const topLevelBlockPosition = (
  pages: any[],
  section: number,
  widget: any
): number => {
  let counted = 0;
  for (const page of pages) {
    for (const body of page?.bodyWidgets ?? []) {
      if (body.sectionIndex !== section) continue;
      for (const child of body.childWidgets ?? []) {
        if (child.previousSplitWidget) continue;
        if (child === widget) return counted;
        counted++;
      }
    }
  }
  return -1;
};

/**
 * The engine anchors ("section;block") of the tables that are still in the
 * document, read AFTER a resolve. Counted over the live body widgets rather
 * than read off the SDK's cached block index, which a resolve that removed a
 * block above has not necessarily refreshed yet; a block split across pages is
 * counted once, at its first piece. A table that left the document (a rejected
 * insertion) or sits inside another table has no top-level anchor.
 */
export function liveTableAnchorsOf(
  editor: LiveEditor,
  tables: Iterable<any>
): Set<string> {
  const anchors = new Set<string>();
  const pages: any[] = (editor as any).documentHelper?.pages ?? [];
  for (const table of tables) {
    const first = table?.getSplitWidgets?.()?.[0] ?? table;
    if (!widgetTreeAttached(first)) continue;
    const container = first.containerWidget;
    if (!container || container.ownerTable) continue;
    const section = container.sectionIndex ?? container.index;
    if (!Number.isInteger(section)) continue;
    let block = topLevelBlockPosition(pages, section, first);
    if (block < 0 && Number.isInteger(first.index)) block = first.index;
    if (block >= 0) anchors.add(`${section};${block}`);
  }
  return anchors;
}

/**
 * Derived state follows the document, so every resolve path ends here:
 * formula outputs are written untracked and recompute at once (the binding
 * runtime installs that hook when it attaches, attachBindings), and the stripe
 * of every table the resolved revisions lived in is re-laid from its current
 * rows (installed by the change-set runner; see restripeBandedTables). Only
 * THOSE tables: a resolve must never change content outside the change sets it
 * resolved, so untouched tables are not re-read, let alone repainted.
 */
function recomputeDerivedValuesAfterResolve(
  editor: LiveEditor,
  touchedTables: Iterable<any>
): void {
  const failures: unknown[] = [];
  const hook = (editor as any).__robinRecomputeAfterResolve;
  if (typeof hook === 'function') {
    try {
      hook();
    } catch (error) {
      failures.push(error);
    }
  }
  const restripe = (editor as any).__robinRestripeAfterResolve;
  if (typeof restripe === 'function') {
    try {
      const anchors = liveTableAnchorsOf(editor, touchedTables);
      if (anchors.size) restripe(anchors);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
}

export function resolveLiveRevisionGroupsAsOneUndo(
  editor: LiveEditor,
  groups: RevisionGroupIdentity[],
  isAccept: boolean
): RevisionResolveOutcome {
  return withProgrammaticSelection(() =>
    resolveLiveRevisionGroupsAsOneUndoInner(editor, groups, isAccept)
  );
}

function resolveLiveRevisionGroupsAsOneUndoInner(
  editor: LiveEditor,
  groups: RevisionGroupIdentity[],
  isAccept: boolean
): RevisionResolveOutcome {
  const tagged = new Set(
    groups
      .filter((group) => !group.untagged)
      .map((group) => `${group.changeSetId}\u0000${group.group}`)
  );
  const bundles = new Set(
    groups
      .map((group) => group.reviewBundleId)
      .filter((bundle): bundle is string => !!bundle)
  );
  const authors = new Set(
    groups.filter((group) => group.untagged).map((group) => group.group)
  );
  const matchesGroup = (revision: LiveRevision) => {
    // Memoized identity read: this runs once per revision per loop iteration
    // below — a full tag parse here is O(n^2) JSON.parse across a bulk resolve.
    const tag = revisionTagIdentity(revision.customData);
    const fullTag = parseRevisionGroupTag(revision.customData);
    return tag
      ? (!!fullTag?.reviewBundleId && bundles.has(fullTag.reviewBundleId)) ||
          tagged.has(`${tag.changeSetId}\u0000${tag.group}`)
      : authors.has(String(revision.author ?? '').trim() || 'Unknown author');
  };
  const initial = liveRevisionsRaw(editor).filter(matchesGroup);
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
  const failed = new Set<LiveRevision>();
  const attempted = new Set<LiveRevision>();
  const members = () => liveRevisionsRaw(editor).filter(matchesGroup);
  const resolveOrder = (left: LiveRevision, right: LiveRevision): number => {
    const leftSequence = parseRevisionGroupTag(left.customData)?.sequence ?? 0;
    const rightSequence =
      parseRevisionGroupTag(right.customData)?.sequence ?? 0;
    const bySequence = isAccept
      ? leftSequence - rightSequence
      : rightSequence - leftSequence;
    if (bySequence) return bySequence;
    return Number(revisionSpansRow(right)) - Number(revisionSpansRow(left));
  };
  // Read before anything resolves: an accepted deletion takes its rows' widgets
  // out of the tree, and the table they were in is exactly the one to restripe.
  const touchedTables = tablesTouchedByRevisions(initial);
  // The SDK's own group path: one selection over the card, members resolved as
  // group members (see resolveSingleRevision), the table relaid once at the end.
  const selection: any = (editor as any).selection ?? null;
  const selectionModule: any = (editor as any).selectionModule ?? selection;
  const priorSelection =
    selection && typeof selection.startOffset === 'string'
      ? {
          start: selection.startOffset,
          end: selection.endOffset || selection.startOffset
        }
      : null;
  try {
    if (initial.length && typeof selectionModule?.selectRevision === 'function')
      selectionModule.selectRevision(initial[0]);
  } catch {
    // Selection is a courtesy to the SDK's layout; resolution does not need it.
  }
  if (selection) selection.isModifyingSelectionInternally = true;
  try {
    let budget = Math.max(20, initial.length * 4);
    // Advance only when the target leaves or a cascade shrinks the group.
    while (budget-- > 0) {
      // A member the previous step emptied or detached is retired here, not
      // resolved: see revisionIsUnresolvable.
      purgeUnresolvableRevisions(editor);
      const before = members();
      const current = before
        .filter((revision) => !failed.has(revision))
        .sort(resolveOrder);
      if (!current.length) break;
      const revision = current[0];
      (revision as any).robinReviveSelf?.();
      attempted.add(revision);
      let threw = false;
      try {
        resolveRevisionIndividually(revision, isAccept, false);
      } catch {
        threw = true;
        // The bounded loop can continue with the next current member.
      }
      const after = members();
      const progressed =
        !threw && (!after.includes(revision) || after.length < before.length);
      if (!progressed) failed.add(revision);
    }
  } finally {
    if (selection) selection.isModifyingSelectionInternally = false;
    try {
      const paragraph = selection?.start?.paragraph;
      const table = paragraph?.isInsideTable
        ? paragraph.containerWidget?.ownerTable
        : null;
      if (table) (editor as any).documentHelper?.layout?.reLayoutTable?.(table);
    } catch {
      // A failed relayout leaves the SDK's own lazy relayout to run.
    }
    try {
      if (priorSelection && typeof selection?.select === 'function')
        selection.select(priorSelection.start, priorSelection.end);
    } catch {
      // The prior selection may no longer exist after a structural resolve.
    }
    if (complex) {
      try {
        history?.updateComplexHistory?.();
      } catch {
        // History bookkeeping cannot undo a completed resolution.
      }
    }
  }
  // Purge document-wide because cascades can create untagged leaks.
  const purged = new Set(purgeUnresolvableRevisions(editor));
  if (initial.length) invalidateDocumentLayout(editor);
  recomputeDerivedValuesAfterResolve(editor, touchedTables);
  // Final membership, not call count, determines the outcome.
  const live = new Set(members());
  // Retired leaks belong in neither result list.
  return resolveOutcome(
    [...attempted].filter(
      (revision) => !live.has(revision) && !purged.has(revision)
    ),
    [...live]
  );
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
  changeSetIds?: string[];
  group: string;
  reviewBundleId?: string;
  resourceKeys?: string[];
  untagged?: boolean;
  derivedChanges?: DerivedValueChange[];
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
    return leftTag.reviewBundleId && rightTag.reviewBundleId
      ? leftTag.reviewBundleId === rightTag.reviewBundleId
      : leftTag.changeSetId === rightTag.changeSetId &&
          leftTag.group === rightTag.group;
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
  const firstSequenceByView = new Map<string, number>();
  const derivedByView = new Map<
    string,
    Map<string, Map<string, { sequence: number; change: DerivedValueChange }>>
  >();
  for (const revision of snapshotRevisions(editor)) {
    const tag = parseRevisionGroupTag(revision.customData);
    // The invisible per-change-set identity suffix is not for readers.
    const author =
      String(revision.author ?? '')
        .replace(/[\u2060\u2061]/g, '')
        .trim() || 'Unknown author';
    const bundled =
      !!tag?.reviewBundleId && (tag.changeSetIds?.length ?? 1) > 1;
    const key = tag
      ? bundled
        ? `bundle ${tag.reviewBundleId}`
        : `${tag.changeSetId} ${tag.group}`
      : `author ${author}`;
    let view = views.get(key);
    if (!view) {
      view = tag
        ? {
            changeSetId: tag.changeSetId,
            changeSetIds: tag.changeSetIds ?? [tag.changeSetId],
            group: tag.group,
            ...(bundled && tag.reviewBundleId
              ? { reviewBundleId: tag.reviewBundleId }
              : {}),
            ...(tag.resourceKeys ? { resourceKeys: tag.resourceKeys } : {}),
            items: []
          }
        : { changeSetId: '', group: author, untagged: true, items: [] };
      views.set(key, view);
      if (tag) firstSequenceByView.set(key, tag.sequence ?? 0);
    } else if (tag) {
      const sequence = tag.sequence ?? 0;
      if (sequence < (firstSequenceByView.get(key) ?? sequence)) {
        view.changeSetId = tag.changeSetId;
        view.group = tag.group;
        firstSequenceByView.set(key, sequence);
      }
      view.changeSetIds = [
        ...new Set([
          ...(view.changeSetIds ?? []),
          ...(tag.changeSetIds ?? [tag.changeSetId])
        ])
      ];
      if (tag.resourceKeys?.length)
        view.resourceKeys = [
          ...new Set([...(view.resourceKeys ?? []), ...tag.resourceKeys])
        ].sort();
    }
    if (tag?.derivedChanges?.length) {
      const byName = derivedByView.get(key) ?? new Map();
      const sequence = tag.sequence ?? 0;
      for (const change of tag.derivedChanges) {
        const bySource = byName.get(change.name) ?? new Map();
        bySource.set(
          `${tag.changeSetId}\u0000${tag.group}\u0000${sequence}\u0000${change.beforeText}\u0000${change.afterText}`,
          { sequence, change }
        );
        byName.set(change.name, bySource);
      }
      derivedByView.set(key, byName);
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
  for (const [key, byName] of derivedByView) {
    const view = views.get(key);
    if (!view) continue;
    view.derivedChanges = [...byName.entries()].map(([name, bySource]) => {
      const ordered = [...bySource.values()].sort(
        (left, right) => left.sequence - right.sequence
      );
      return {
        name,
        beforeText: ordered[0].change.beforeText,
        afterText: ordered[ordered.length - 1].change.afterText
      };
    });
  }
  return [...views.values()];
}

const selectForAppearance = (
  editor: LiveEditor,
  cellAnchor: string,
  extent: 'cell' | 'row'
) =>
  withLiveSelection(editor, () => {
    editor.selection.select(`${cellAnchor};0`, `${cellAnchor};0`);
    const method = extent === 'row' ? 'selectRow' : 'selectCell';
    editor.selection?.[method]?.();
  });

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
  const table = liveTableWidgetAt(editor, tableAnchor);
  (table?.childWidgets ?? []).forEach((row: any, rowIndex: number) => {
    let logicalColumn = 0;
    (row?.childWidgets ?? []).forEach((cell: any, cellIndex: number) => {
      const span = Math.max(1, Number(cell?.cellFormat?.columnSpan) || 1);
      const preferredWidth = columnWidths
        .slice(logicalColumn, logicalColumn + span)
        .reduce((sum, width) => sum + width, 0);
      logicalColumn += span;
      if (!(preferredWidth > 0)) return;
      selectForAppearance(
        editor,
        `${tableAnchor};${rowIndex};${cellIndex};0`,
        'cell'
      );
      const cellFormat = editor.selection?.cellFormat;
      if (!cellFormat) return;
      cellFormat.preferredWidth = preferredWidth;
      cellFormat.preferredWidthType = layout.columnWidthType ?? 'Auto';
    });
  });
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
      clampCandidates: BookmarkClampIntent[][];
      expressionCandidates: ExpressionRestore[][];
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
      if (tag.bookmarkClamps)
        partition.clampCandidates.push(tag.bookmarkClamps);
      if (tag.expressionRestores)
        partition.expressionCandidates.push(tag.expressionRestores);
    } else {
      partitions.set(key, {
        changeSetId: tag.changeSetId,
        group: tag.group,
        revisions: [revision],
        restoreCandidates: tag.appearanceRestores
          ? [tag.appearanceRestores]
          : [],
        styleCandidates: tag.paragraphStyles ? [tag.paragraphStyles] : [],
        clampCandidates: tag.bookmarkClamps ? [tag.bookmarkClamps] : [],
        expressionCandidates: tag.expressionRestores
          ? [tag.expressionRestores]
          : []
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
    // Same agreement rule again: every member of a group carries the same
    // clamp payload, so disagreement means a stale or mixed tag and the safe
    // reading is to clamp nothing.
    const clampPayloads = new Map(
      partition.clampCandidates.map((clamps) => [
        JSON.stringify(clamps),
        clamps
      ])
    );
    const clamps =
      clampPayloads.size === 1 ? [...clampPayloads.values()][0] : undefined;
    // Same agreement rule once more, for the expression inverse.
    const expressionPayloads = new Map(
      partition.expressionCandidates.map((entries) => [
        JSON.stringify(entries),
        entries
      ])
    );
    const expressions =
      expressionPayloads.size === 1
        ? [...expressionPayloads.values()][0]
        : undefined;
    groupRevisionsAtomic(
      editor,
      partition.revisions,
      partition.changeSetId,
      partition.group,
      restores,
      styles,
      clamps,
      expressions
    );
    bound += partition.revisions.length;
  });
  return bound;
}
