// "Insert column" drops cell styling in Syncfusion 34.1.31: insertColumn copies
// the neighbour's cellFormat, then overwrites the new cell's shading with the
// TABLE's shading object and clears its borders. Paragraph and character
// formats are copied (copyCellFormats), so a header column comes out with the
// header's white text on no fill — it reads as a blank, unstyled cell. Word
// gives the new cell the fill and borders of the column it was inserted from;
// do the same.
//
// copyCellFormats runs once per row, before the table is re-laid out, and
// insertColumn is its only caller. Its `index` is a COLUMN index, not the new
// cell's position in the row - they differ wherever a cell spans columns or
// rows - so the new cell is found by identity: the cells createColumn makes
// during the insert. Undo needs nothing: insertColumn clones the whole table
// into history before inserting.
const COLUMN_INSERT_PATCH = '__featheryTableColumnInsertFix';

// Exported for tests (installed automatically at editor create).
export function installTableColumnInsertFix(ed: any) {
  const editorModule = ed?.editorModule;
  if (!editorModule || editorModule[COLUMN_INSERT_PATCH]) return;
  const { insertColumn, createColumn, copyCellFormats } = editorModule;
  if (
    typeof createColumn !== 'function' ||
    typeof copyCellFormats !== 'function' ||
    // Upstream stopped discarding cell borders (or reshaped insertColumn):
    // leave the native implementation alone. EJ2_VERSION is pinned, so this
    // probe only decides behavior across deliberate version bumps.
    !/borders\.clearFormat\(\)/.test(insertColumn?.toString?.() ?? '')
  ) {
    return;
  }
  editorModule[COLUMN_INSERT_PATCH] = true;

  // The insert in progress: its direction, and the cells it created that are
  // still waiting for their styling.
  let inserting: { left: boolean; created: Set<unknown> } | null = null;

  editorModule.insertColumn = function (left: boolean, ...rest: unknown[]) {
    const outer = inserting;
    inserting = { left: !!left, created: new Set() };
    try {
      return insertColumn.call(this, left, ...rest);
    } finally {
      inserting = outer;
    }
  };

  editorModule.createColumn = function (...args: unknown[]) {
    const cell = createColumn.apply(this, args);
    inserting?.created.add(cell);
    return cell;
  };

  editorModule.copyCellFormats = function (row: any, index: number) {
    copyCellFormats.call(this, row, index);
    if (!inserting) return;
    const cells: any[] = row?.childWidgets ?? [];
    const created = inserting.created;
    const position = cells.findIndex((cell) => created.has(cell));
    if (position < 0) return;
    const newCell = cells[position];
    created.delete(newCell);
    // The column it was inserted from: right of a cell inserted to the left,
    // left of one inserted to the right (the other side only at a row edge).
    const step = inserting.left ? 1 : -1;
    const source = (cells[position + step] ?? cells[position - step])
      ?.cellFormat;
    const format = newCell.cellFormat;
    if (!format) return;
    // Until here the new cell's shading IS the table's shading object; editing
    // it later would recolor the whole table. Always give the cell its own.
    const shading = source?.shading ?? format.shading;
    if (shading) format.shading = shading.cloneFormat();
    if (source?.borders && format.borders)
      format.borders.copyFormat(source.borders);
  };
}
