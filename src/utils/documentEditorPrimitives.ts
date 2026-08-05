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

export interface LiveRevisionCollection {
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

export interface AppearanceRestore {
  cellAnchor: string;
  write?: AppearanceWrite;
  rowIsHeader?: boolean;
  tableBorders?: BorderWrite[];
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

export interface RevisionGroupTag {
  changeSetId: string;
  group: string;
  appearanceRestores?: AppearanceRestore[];
}

export function revisionGroupTag(
  changeSetId: string,
  group: string,
  appearanceRestores?: AppearanceRestore[]
): string {
  return JSON.stringify({
    v: REVISION_GROUP_TAG_VERSION,
    source: 'robin',
    changeSetId,
    group,
    ...(appearanceRestores?.length ? { appearanceRestores } : {})
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
    if (raw.rowIsHeader === undefined && !write && !tableBorders)
      return undefined;
    restores.push({
      cellAnchor: raw.cellAnchor,
      ...(typeof raw.rowIsHeader === 'boolean'
        ? { rowIsHeader: raw.rowIsHeader }
        : {}),
      ...(write ? { write } : {}),
      ...(tableBorders ? { tableBorders } : {})
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
      return {
        changeSetId: parsed.changeSetId,
        group: parsed.group,
        ...(appearanceRestores ? { appearanceRestores } : {})
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

export function groupRevisionsAtomic(
  editor: LiveEditor,
  group: LiveRevision[],
  changeSetId?: string,
  groupId?: string,
  onReject?: () => void
): void {
  if (!group.length) return;
  const members = group.map(captureNativeResolvers);
  const state = { resolved: false };
  const resolvedAlone = new Set<number>();
  const resolveAll = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    if (!isAccept && onReject) {
      try {
        onReject();
      } catch {
        // Content still resolves consistently if an appearance restore fails.
      }
    }
    for (let index = 0; index < members.length; index++) {
      if (resolvedAlone.has(index)) continue;
      try {
        resolveSingleRevision(members[index], isAccept);
      } catch {
        // A later member can become stale after the first resolves.
      }
    }
    if (members.length > 1) invalidateDocumentLayout(editor);
  };
  group.forEach((revision, index) => {
    if (changeSetId) (revision as any).robinChangeSetId = changeSetId;
    if (groupId) (revision as any).robinGroupId = groupId;
    (revision as any).robinGroupBound = true;
    (revision as any).robinResolveSelf = (isAccept: boolean) => {
      if (state.resolved || resolvedAlone.has(index)) return;
      resolvedAlone.add(index);
      resolveSingleRevision(members[index], isAccept);
    };
    (revision as any).robinReviveSelf = () => {
      state.resolved = false;
      resolvedAlone.delete(index);
    };
    revision.accept = () => resolveAll(true);
    revision.reject = () => resolveAll(false);
  });
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

const liveRevisionMember = (
  editor: LiveEditor,
  identity: RevisionMemberIdentity
): LiveRevision | undefined =>
  snapshotRevisions(editor).find((revision) => {
    if (identity.revisionID)
      return (
        String(revision.revisionID ?? '') === identity.revisionID &&
        revisionTagKey(revision.customData) === identity.groupKey &&
        String(revision.author ?? '') === identity.author
      );
    return revision === identity.original;
  });

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
  try {
    for (const identity of [...identities].reverse()) {
      const revision = liveRevisionMember(editor, identity);
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
  const initial = snapshotRevisions(editor).filter(matchesGroup);
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
    while (budget-- > 0) {
      const current = snapshotRevisions(editor).filter(matchesGroup);
      if (!current.length) break;
      const revision = current[current.length - 1];
      (revision as any).robinReviveSelf?.();
      resolved.push(revision);
      try {
        resolveRevisionIndividually(revision, isAccept);
      } catch {
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
  revision: LiveRevision;
  revisionType: string;
  text: string;
  beforeText?: string;
  partner?: LiveRevision;
  author?: string;
}

export interface RevisionGroupView {
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
    const item: RevisionGroupItem = {
      revision,
      revisionType: String(revision.revisionType ?? ''),
      text: revisionRangeText(revision),
      author
    };
    const previous = view.items[view.items.length - 1];
    if (
      previous &&
      !previous.partner &&
      previous.revisionType === 'Deletion' &&
      item.revisionType === 'Insertion' &&
      isReplacePair(previous.revision, item.revision)
    ) {
      previous.partner = item.revision;
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

const replayAppearanceRestores = (
  editor: LiveEditor,
  restores: AppearanceRestore[]
) => {
  for (let index = restores.length - 1; index >= 0; index--) {
    const restore = restores[index];
    if (restore.tableBorders) {
      const tableAnchor = restore.cellAnchor.split(';').slice(0, 2).join(';');
      const cellAnchor = `${tableAnchor};0;0;0`;
      const selectTable = () => {
        selectForAppearance(editor, cellAnchor, 'cell');
        editor.selection?.selectTable?.();
      };
      selectTable();
      for (const border of restore.tableBorders) {
        applyBorders(editor, [border]);
        selectTable();
      }
    }
    if (restore.rowIsHeader !== undefined) {
      selectForAppearance(editor, restore.cellAnchor, 'row');
      if (editor.selection?.rowFormat)
        editor.selection.rowFormat.isHeader = restore.rowIsHeader;
    }
    if (restore.write) {
      selectForAppearance(editor, restore.cellAnchor, 'cell');
      const cellFormat = editor.selection?.cellFormat;
      if (cellFormat) {
        if (restore.write.shading !== undefined)
          cellFormat.background = restore.write.shading ?? 'empty';
        if (restore.write.verticalAlignment)
          cellFormat.verticalAlignment = restore.write.verticalAlignment;
      }
      for (const border of restore.write.borders ?? []) {
        applyBorders(editor, [border]);
        selectForAppearance(editor, restore.cellAnchor, 'cell');
      }
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
    } else {
      partitions.set(key, {
        changeSetId: tag.changeSetId,
        group: tag.group,
        revisions: [revision],
        restoreCandidates: tag.appearanceRestores
          ? [tag.appearanceRestores]
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
    groupRevisionsAtomic(
      editor,
      partition.revisions,
      partition.changeSetId,
      partition.group,
      restores?.length
        ? () => replayAppearanceRestores(editor, restores)
        : undefined
    );
    bound += partition.revisions.length;
  });
  return bound;
}
