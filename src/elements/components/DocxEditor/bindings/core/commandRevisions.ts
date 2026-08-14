// Assistant commands are authored as SFDT revisions rather than by leaving
// Syncfusion's global tracking switch on. The engine remains untracked unless
// the caller supplies explicit provenance for this one command batch.

import type { BindingCommandProvenance } from '../reconcileRegistry';
import {
  getAt,
  scanBindings,
  setAt
} from './sfdtAdapter';
import type { Occurrence } from './sfdtAdapter';
import type { SfdtDocument, SfdtInline } from './sfdtTypes';

let revisionSequence = 0;

function freshRevisionId(): string {
  revisionSequence += 1;
  return `robin-${Date.now().toString(36)}-${revisionSequence.toString(
    36
  )}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function occurrenceBuckets(
  occurrences: Occurrence[]
): Map<string, Occurrence[]> {
  const buckets = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const bucket = buckets.get(occurrence.tag);
    if (bucket) bucket.push(occurrence);
    else buckets.set(occurrence.tag, [occurrence]);
  }
  return buckets;
}

function revisionIdsOfType(
  sfdt: SfdtDocument,
  type: 'Insertion' | 'Deletion'
): Set<string> {
  const ids = new Set<string>();
  const revisions = Array.isArray(sfdt.revisions) ? sfdt.revisions : [];
  for (const revision of revisions as any[]) {
    if (String(revision?.revisionType) !== type) continue;
    const id = revision?.revisionId ?? revision?.revisionID;
    if (id != null) ids.add(String(id));
  }
  return ids;
}

function hasOnlyRevisionIds(node: any, ids: Set<string>): boolean {
  return (
    Array.isArray(node?.revisionIds) &&
    node.revisionIds.length > 0 &&
    node.revisionIds.every((id: unknown) => ids.has(String(id)))
  );
}

function textWithoutRevisions(node: any, omitted: Set<string>): string {
  if (Array.isArray(node))
    return node.map((entry) => textWithoutRevisions(entry, omitted)).join('');
  if (!node || typeof node !== 'object') return '';
  if (hasOnlyRevisionIds(node, omitted)) return '';
  if (typeof node.text === 'string') return node.text;
  const inlines = node.inlines ?? node.blocks ?? [];
  return textWithoutRevisions(inlines, omitted);
}

function trackedRun(
  node: any,
  text: string,
  revisionId: string
): SfdtInline {
  const source = (node?.inlines ?? []).find(
    (inline: any) => inline && typeof inline.text === 'string'
  );
  return {
    ...(source?.characterFormat
      ? { characterFormat: clone(source.characterFormat) }
      : {}),
    text,
    revisionIds: [revisionId]
  };
}

function revisionIdsIn(node: any, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((entry) => revisionIdsIn(entry, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node.revisionIds))
    node.revisionIds.forEach((id: unknown) => out.add(String(id)));
  Object.values(node).forEach((value) => revisionIdsIn(value, out));
  return out;
}

function tableIn(node: any): any | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node.rows)) return node;
  for (const block of node.blocks ?? []) {
    const found = tableIn(block);
    if (found) return found;
  }
  return undefined;
}

function isEmptyParagraph(node: any): boolean {
  return (
    !!node && Array.isArray(node.inlines) && node.inlines.length === 0
  );
}

/**
 * Add first-class review records to one explicit assistant command batch.
 * Calls without provenance never reach this function, so ordinary reconcile,
 * user typing and existing command callers retain their native history path.
 */
export function authorCommandRevisions(
  before: SfdtDocument,
  after: SfdtDocument,
  provenance: BindingCommandProvenance
): SfdtDocument {
  const beforeIndex = scanBindings(before);
  const afterIndex = scanBindings(after);
  const beforeByTag = occurrenceBuckets(beforeIndex.occurrences);
  const seenByTag = new Map<string, number>();
  let revisions = [...(Array.isArray(after.revisions) ? after.revisions : [])];
  let next = after;
  let authored = false;
  const date = new Date().toISOString();
  const customData = JSON.stringify({
    v: 1,
    source: 'robin',
    changeSetId: provenance.changeSetId,
    group: provenance.group
  });
  const addRevision = (
    revisionType: 'Insertion' | 'Deletion',
    revisionId: string
  ) => {
    authored = true;
    revisions.push({
      author: provenance.author,
      date,
      revisionType,
      revisionId,
      customData
    });
  };

  for (const occurrence of afterIndex.occurrences) {
    const ordinal = seenByTag.get(occurrence.tag) ?? 0;
    seenByTag.set(occurrence.tag, ordinal + 1);
    const previous = beforeByTag.get(occurrence.tag)?.[ordinal];
    if (!previous || previous.text === occurrence.text) continue;

    const deletionId = freshRevisionId();
    const insertionId = freshRevisionId();
    const oldNode = getAt(before, previous.path);
    const newNode = getAt(next, occurrence.path);
    const superseded = revisionIdsIn(oldNode);
    const originalText = superseded.size
      ? textWithoutRevisions(oldNode, revisionIdsOfType(before, 'Insertion'))
      : previous.text;
    if (superseded.size)
      revisions = revisions.filter((revision: any) => {
        const id = revision?.revisionId ?? revision?.revisionID;
        return id == null || !superseded.has(String(id));
      });
    next = setAt(next, occurrence.path, {
      ...newNode,
      inlines: [
        trackedRun(oldNode, originalText, deletionId),
        trackedRun(newNode, occurrence.text, insertionId)
      ]
    });
    addRevision('Deletion', deletionId);
    addRevision('Insertion', insertionId);
  }

  const beforeTables = beforeIndex.tables;
  const afterTables = afterIndex.tables;
  const insertedTableIds = new Set(
    [...afterTables.keys()].filter((tableId) => !beforeTables.has(tableId))
  );
  const deletedTableIds = new Set(
    [...beforeTables.keys()].filter((tableId) => !afterTables.has(tableId))
  );

  for (const tableId of insertedTableIds) {
    const table = afterTables.get(tableId);
    if (!table?.tablePath) continue;
    const revisionId = freshRevisionId();
    const rawTable = clone(getAt(next, table.tablePath));
    rawTable.rows = (rawTable.rows ?? []).map((row: any) => ({
      ...row,
      rowFormat: {
        ...(row.rowFormat ?? {}),
        revisionIds: [revisionId]
      }
    }));
    next = setAt(next, table.tablePath, rawTable);

    const parentPath = table.markerPath.slice(0, -1);
    const at = Number(table.markerPath[table.markerPath.length - 1]);
    const siblings = getAt(next, parentPath);
    const markSeparator = (index: number) => {
      const separator = Array.isArray(siblings) ? siblings[index] : undefined;
      if (!isEmptyParagraph(separator)) return;
      next = setAt(next, [...parentPath, index], {
        ...separator,
        characterFormat: {
          ...(separator.characterFormat ?? {}),
          revisionIds: [revisionId]
        }
      });
    };
    // add-table always creates the leading separator. It creates the trailing
    // one only when the source table previously touched another table.
    markSeparator(at - 1);
    const priorSiblingWasTable = [...beforeTables.values()].some((candidate) => {
      if (
        JSON.stringify(candidate.markerPath.slice(0, -1)) !==
        JSON.stringify(parentPath)
      )
        return false;
      const candidateAt = Number(
        candidate.markerPath[candidate.markerPath.length - 1]
      );
      const beforeSiblings = getAt(before, parentPath);
      return (
        candidateAt < at &&
        Array.isArray(beforeSiblings) &&
        !!tableIn(beforeSiblings[candidateAt + 1])
      );
    });
    if (priorSiblingWasTable) markSeparator(at + 1);
    addRevision('Insertion', revisionId);
  }

  for (const [tableId, afterTable] of afterTables) {
    if (insertedTableIds.has(tableId) || !afterTable.tablePath) continue;
    const beforeTable = beforeTables.get(tableId);
    if (!beforeTable) continue;
    const beforeRows = new Map(
      beforeTable.rows
        .filter((row) => row.rowId)
        .map((row) => [row.rowId as string, row])
    );
    const afterRows = new Map(
      afterTable.rows
        .filter((row) => row.rowId)
        .map((row) => [row.rowId as string, row])
    );

    const inserted = [...afterRows.keys()].filter(
      (rowId) => !beforeRows.has(rowId)
    );
    if (inserted.length) {
      const revisionId = freshRevisionId();
      for (const rowId of inserted) {
        const row = afterRows.get(rowId);
        if (!row?.path) continue;
        const rawRow = getAt(next, row.path);
        next = setAt(next, row.path, {
          ...rawRow,
          rowFormat: {
            ...(rawRow.rowFormat ?? {}),
            revisionIds: [revisionId]
          }
        });
      }
      addRevision('Insertion', revisionId);
    }

    const deleted = [...beforeRows.entries()]
      .filter(([rowId]) => !afterRows.has(rowId))
      .map(([, row]) => row)
      .filter((row) => row.path)
      .sort((left, right) => {
        const leftPath = left.path as Array<string | number>;
        const rightPath = right.path as Array<string | number>;
        return (
          Number(leftPath[leftPath.length - 1]) -
          Number(rightPath[rightPath.length - 1])
        );
      });
    if (deleted.length) {
      const revisionId = freshRevisionId();
      const rawTable = clone(getAt(next, afterTable.tablePath));
      const rows = [...(rawTable.rows ?? [])];
      for (const row of deleted) {
        const rowPath = row.path as Array<string | number>;
        const at = Number(rowPath[rowPath.length - 1]);
        const oldRow = clone(getAt(before, rowPath));
        oldRow.rowFormat = {
          ...(oldRow.rowFormat ?? {}),
          revisionIds: [revisionId]
        };
        rows.splice(at, 0, oldRow);
      }
      rawTable.rows = rows;
      next = setAt(next, afterTable.tablePath, rawTable);
      addRevision('Deletion', revisionId);
    }
  }

  for (const tableId of deletedTableIds) {
    const table = beforeTables.get(tableId);
    if (!table) continue;
    const revisionId = freshRevisionId();
    const wrapper = clone(getAt(before, table.markerPath));
    const rawTable = tableIn(wrapper);
    if (rawTable)
      rawTable.rows = (rawTable.rows ?? []).map((row: any) => ({
        ...row,
        rowFormat: {
          ...(row.rowFormat ?? {}),
          revisionIds: [revisionId]
        }
      }));
    const parentPath = table.markerPath.slice(0, -1);
    const at = Number(table.markerPath[table.markerPath.length - 1]);
    const siblings = getAt(next, parentPath);
    if (Array.isArray(siblings))
      next = setAt(next, parentPath, [
        ...siblings.slice(0, at),
        wrapper,
        ...siblings.slice(at)
      ]);
    addRevision('Deletion', revisionId);
  }

  return authored ? ({ ...next, revisions } as SfdtDocument) : next;
}
