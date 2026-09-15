import { CellErrors, cellErrorKey } from './validation';

/**
 * Who marked a cell, and how much their mark is trusted.
 *
 *  - `hub_rule`: the Data Hub's own field rules (required, format, options,
 *    unique...). Always an error. It blocks the save on a verified row,
 *    because the hub would reject the write anyway. On an unverified row it
 *    is still red — the value is wrong — but the save goes through: staged
 *    data exists to be corrected, and a half-fixed row is better stored than
 *    lost.
 *  - `rule`: a logic rule the form's author wrote. It picks its own severity,
 *    because a person decided what the check means: an error holds the step
 *    back, a warning is advice.
 *  - `assistant`: something Robin noticed. Always a warning, never blocking —
 *    no human wrote the predicate, so it does not get to stop a submission.
 *    A check that must block is written as a logic rule, which Robin can call.
 */
export type AnnotationSource = 'hub_rule' | 'rule' | 'assistant';
export type AnnotationSeverity = 'error' | 'warning';

/**
 * How a producer names a row.
 *
 *  - `rowKey`: the row's own identity, minted by the table and stable for as
 *    long as the row exists. Survives sorting, filtering, and rows being added
 *    or removed around it. This is what producers should use.
 *  - `entryId`: the Data Hub entry a row is showing. Equivalent to a row key
 *    for saved hub rows, and meaningful to a caller that only knows the hub.
 *  - `rowIndex`: the row's position in the source data. Convenient to write and
 *    fine within one turn, but it names a position, not a row — the next insert
 *    above it moves it. Callers that keep annotations around resolve an index
 *    to a row key at the time they write it.
 */
export type TableRowRef =
  | { rowIndex: number }
  | { entryId: string }
  | { rowKey: string };

/**
 * Where an annotation lands. Fields are named the way the table's author sees
 * them (the Data Hub field key, or the column name / form field key of a
 * field-backed table), never by the grid's internal storage keys.
 */
export type TableAnnotationTarget =
  | { kind: 'cell'; row: TableRowRef; field: string }
  | { kind: 'row'; row: TableRowRef }
  | {
      kind: 'range';
      from: { row: TableRowRef; field: string };
      to: { row: TableRowRef; field: string };
    };

/** What a producer sends. */
export type TableAnnotation = {
  target: TableAnnotationTarget;
  message: string;
  /** Defaults to the source's own default; `assistant` is always a warning. */
  severity?: AnnotationSeverity;
};

/** What a cell ends up showing. */
export type CellAnnotation = {
  message: string;
  source: AnnotationSource;
  severity: AnnotationSeverity;
  blocking: boolean;
};

/** `${rowIndex}:${fieldKey}` -> the annotation shown on that cell. */
export type CellAnnotations = Record<string, CellAnnotation>;

export type ResolveAnnotationsContext = {
  /** Source row indices currently rendered, in display order. */
  rowIndices: number[];
  /** Rendered columns' storage keys, left to right. */
  fieldKeys: string[];
  /** Author-facing field name -> storage key; undefined when unknown. */
  resolveField: (name: string) => string | undefined;
  /** Row reference -> source row index; undefined when the row is not shown. */
  resolveRow: (ref: TableRowRef) => number | undefined;
};

/** One producer's annotations, expanded onto the cells they cover. */
export type AnnotationLayer = Record<
  string,
  { message: string; severity: AnnotationSeverity; source: AnnotationSource }
>;

export type ResolvedAnnotations = {
  cells: AnnotationLayer;
  /** Annotations that named a row or field the table does not have. */
  unresolved: TableAnnotation[];
};

const DEFAULT_SEVERITY: Record<AnnotationSource, AnnotationSeverity> = {
  hub_rule: 'error',
  rule: 'error',
  assistant: 'warning'
};

const severityOf = (
  annotation: TableAnnotation,
  source: AnnotationSource
): AnnotationSeverity => {
  // Robin does not get to choose: an LLM-authored finding is advisory, whatever
  // it asked for. See `AnnotationSource`.
  if (source === 'assistant') return 'warning';
  return annotation.severity ?? DEFAULT_SEVERITY[source];
};

/**
 * Expands row- and range-scoped annotations onto the cells they cover. A cell
 * named more than once by the same producer keeps the first message, so a
 * producer controls what shows by the order it sends them.
 */
export function resolveTableAnnotations(
  annotations: TableAnnotation[],
  context: ResolveAnnotationsContext,
  source: AnnotationSource
): ResolvedAnnotations {
  const cells: AnnotationLayer = {};
  const unresolved: TableAnnotation[] = [];
  const shownRows = new Set(context.rowIndices);
  const columnIndex = new Map(
    context.fieldKeys.map((key, index) => [key, index])
  );

  const rowOf = (ref: TableRowRef): number | undefined => {
    const rowIndex = context.resolveRow(ref);
    return rowIndex !== undefined && shownRows.has(rowIndex)
      ? rowIndex
      : undefined;
  };
  const columnOf = (name: string): number | undefined => {
    const key = context.resolveField(name);
    return key === undefined ? undefined : columnIndex.get(key);
  };

  annotations.forEach((annotation) => {
    const { target, message } = annotation;
    const severity = severityOf(annotation, source);
    const mark = (rowIndex: number, fieldKey: string) => {
      const key = cellErrorKey(rowIndex, fieldKey);
      if (!(key in cells)) cells[key] = { message, severity, source };
    };

    if (target.kind === 'cell') {
      const rowIndex = rowOf(target.row);
      const fieldKey = context.resolveField(target.field);
      if (rowIndex === undefined || !fieldKey || !columnIndex.has(fieldKey)) {
        unresolved.push(annotation);
        return;
      }
      mark(rowIndex, fieldKey);
      return;
    }

    if (target.kind === 'row') {
      const rowIndex = rowOf(target.row);
      if (rowIndex === undefined) {
        unresolved.push(annotation);
        return;
      }
      context.fieldKeys.forEach((fieldKey) => mark(rowIndex, fieldKey));
      return;
    }

    const fromRow = rowOf(target.from.row);
    const toRow = rowOf(target.to.row);
    const fromColumn = columnOf(target.from.field);
    const toColumn = columnOf(target.to.field);
    if (
      fromRow === undefined ||
      toRow === undefined ||
      fromColumn === undefined ||
      toColumn === undefined
    ) {
      unresolved.push(annotation);
      return;
    }
    // A range covers the rows between its corners in DISPLAY order, so a
    // sorted or filtered table still gets the block the author pointed at.
    const rowPositions = new Map(
      context.rowIndices.map((rowIndex, position) => [rowIndex, position])
    );
    const [firstRow, lastRow] = [
      rowPositions.get(fromRow) as number,
      rowPositions.get(toRow) as number
    ].sort((a, b) => a - b);
    const [firstColumn, lastColumn] = [fromColumn, toColumn].sort(
      (a, b) => a - b
    );
    for (let position = firstRow; position <= lastRow; position++) {
      const rowIndex = context.rowIndices[position];
      for (let column = firstColumn; column <= lastColumn; column++) {
        mark(rowIndex, context.fieldKeys[column]);
      }
    }
  });

  return { cells, unresolved };
}

/** `resolveTableAnnotations` when the caller has nowhere to put `unresolved`. */
export const annotationLayer = (
  annotations: TableAnnotation[],
  context: ResolveAnnotationsContext,
  source: AnnotationSource
): AnnotationLayer =>
  resolveTableAnnotations(annotations, context, source).cells;

/**
 * The hub's own field-rule failures as a layer. They arrive already keyed by
 * cell — from the client-side mirror of the hub's rules and from the server's
 * rejections — so there is nothing to expand.
 */
export const cellErrorLayer = (ruleErrors: CellErrors): AnnotationLayer =>
  Object.entries(ruleErrors).reduce(
    (layer: AnnotationLayer, [key, message]) => {
      layer[key] = { message, severity: 'error', source: 'hub_rule' };
      return layer;
    },
    {}
  );

const rowOfKey = (key: string) => Number(key.slice(0, key.indexOf(':')));

const blocks = (
  entry: AnnotationLayer[string],
  rowIndex: number,
  isRowVerified: (rowIndex: number) => boolean
): boolean => {
  if (entry.severity !== 'error') return false;
  if (entry.source === 'assistant') return false;
  // A hub rule on staged data is red but still saves; see `AnnotationSource`.
  if (entry.source === 'hub_rule') return isRowVerified(rowIndex);
  return true;
};

export type BuildCellAnnotationsOptions = {
  /** One entry per producer, in the order they should break ties. */
  layers: AnnotationLayer[];
  /**
   * Whether a row is verified data. A field-backed table has no staging, so
   * every row counts as verified there.
   */
  isRowVerified: (rowIndex: number) => boolean;
};

/**
 * Merges every producer's layer onto cells. Where two producers name the same
 * cell, the one that matters more wins — what holds the step back, then the
 * other errors, then the advice — so the cell the user has to fix is the cell
 * they read. Producers never see each other's messages; only one shows.
 */
export function buildCellAnnotations({
  layers,
  isRowVerified
}: BuildCellAnnotationsOptions): CellAnnotations {
  const annotations: CellAnnotations = {};
  layers.forEach((layer) => {
    Object.entries(layer).forEach(([key, entry]) => {
      const candidate: CellAnnotation = {
        ...entry,
        blocking: blocks(entry, rowOfKey(key), isRowVerified)
      };
      const current = annotations[key];
      if (!current || annotationRank(candidate) < annotationRank(current))
        annotations[key] = candidate;
    });
  });
  return annotations;
}

export type AnnotationCounts = {
  /** Errors that hold the step back until they are fixed. */
  blocking: number;
  /** Errors that do not block: a hub rule broken on a row that is still staged. */
  errors: number;
  /** Advice — warnings from a rule, and everything Robin found. */
  warnings: number;
};

export function countAnnotations(
  annotations: CellAnnotations
): AnnotationCounts {
  const counts: AnnotationCounts = { blocking: 0, errors: 0, warnings: 0 };
  Object.values(annotations).forEach((annotation) => {
    if (annotation.blocking) counts.blocking += 1;
    else if (annotation.severity === 'error') counts.errors += 1;
    else counts.warnings += 1;
  });
  return counts;
}

/**
 * The order the bar's stepper walks annotations in, and the order that decides
 * which producer owns a contested cell.
 */
export const annotationRank = (annotation: CellAnnotation): number =>
  annotation.blocking ? 0 : annotation.severity === 'error' ? 1 : 2;
