import internalState from '../internalState';
import {
  AnnotationSource,
  TableAnnotation
} from '../../elements/basic/TableElement/spreadsheet/annotations';

export type TableRow = Record<string, any> & {
  /** The row's own identity — what an annotation should point at. */
  _key: string;
};

/**
 * What a mounted table offers the rest of the form. Registered by the element
 * on mount and dropped on unmount, so a table on another step simply is not
 * there — the same contract the assistant's table handlers use.
 */
export type TableHandle = {
  /**
   * Replaces this source's annotations, leaving other sources alone. Returns
   * the ones that named a row or column the table does not have.
   */
  setAnnotations: (
    source: AnnotationSource,
    annotations: TableAnnotation[]
  ) => TableAnnotation[];
  clearAnnotations: (source: AnnotationSource) => void;
  /** Every row, in source order, keyed by column name. */
  getRows: () => TableRow[];
};

export type TableHandles = Record<string, TableHandle>;

/**
 * A table, as logic rules see it. Mirrors `Field`: a thin handle onto form
 * state, looked up fresh on every call so it never goes stale.
 */
export default class Table {
  _formUuid: string;
  _tableId: string;

  constructor(formUuid: string, tableId: string) {
    this._formUuid = formUuid;
    this._tableId = tableId;
  }

  get id(): string {
    return this._tableId;
  }

  private _handle(): TableHandle | undefined {
    return internalState[this._formUuid]?.tables?.[this._tableId];
  }

  /** Every row, in source order. Each carries its `_key`. */
  get rows(): TableRow[] {
    return this._handle()?.getRows() ?? [];
  }

  /**
   * Marks cells, rows or ranges of this table. Replaces whatever this rule
   * marked last time, so a rule that runs again does not stack up duplicates.
   *
   * An `error` holds the step back; a `warning` is advice and does not.
   * Annotations that point at a row or column the table does not have are
   * returned, and warned about — a check that quietly marks nothing is worse
   * than one that says so.
   */
  setAnnotations(annotations: TableAnnotation[]): TableAnnotation[] {
    const handle = this._handle();
    if (!handle) {
      console.warn(
        `Table ${this._tableId} is not on this step, so its annotations were not set.`
      );
      return annotations;
    }
    const unresolved = handle.setAnnotations('rule', annotations);
    if (unresolved.length)
      console.warn(
        `${unresolved.length} annotation(s) named a row or column table ${this._tableId} does not have.`,
        unresolved
      );
    return unresolved;
  }

  clearAnnotations() {
    this._handle()?.clearAnnotations('rule');
  }
}
