// "Insert column" drops cell styling in Syncfusion 34.1.31: insertColumn copies
// the neighbour's cellFormat, then overwrites the new cell's shading with the
// TABLE's shading object and clears its borders. Paragraph and character
// formats are copied (copyCellFormats), so a header column comes out with the
// header's white text on no fill — it reads as a blank, unstyled cell. Word
// copies the adjacent cell's fill and borders; do the same.
//
// copyCellFormats is called once per row with the new cell's index, before the
// table is re-laid out, and insertColumn is its only caller. Undo needs
// nothing: insertColumn clones the whole table into history before inserting.
const COLUMN_INSERT_PATCH = '__featheryTableColumnInsertFix';

// Exported for tests (installed automatically at editor create).
export function installTableColumnInsertFix(ed: any) {
  const editorModule = ed?.editorModule;
  if (!editorModule || editorModule[COLUMN_INSERT_PATCH]) return;
  const copyCellFormats = editorModule.copyCellFormats;
  if (
    typeof copyCellFormats !== 'function' ||
    typeof editorModule.insertColumn !== 'function' ||
    // Upstream stopped discarding cell borders (or reshaped insertColumn):
    // leave the native implementation alone. EJ2_VERSION is pinned, so this
    // probe only decides behavior across deliberate version bumps.
    !/borders\.clearFormat\(\)/.test(editorModule.insertColumn.toString())
  ) {
    return;
  }
  editorModule[COLUMN_INSERT_PATCH] = true;

  editorModule.copyCellFormats = function (row: any, index: number) {
    copyCellFormats.call(this, row, index);
    const cells = row?.childWidgets;
    const newCell = cells?.[index];
    // Same neighbour copyCellFormats takes paragraph/character formats from.
    const source = cells?.[index === cells.length - 1 ? index - 1 : index + 1];
    if (!newCell?.cellFormat || !source?.cellFormat || source === newCell)
      return;
    // The new cell's shading IS the table's shading object; mutating it would
    // recolor the table, so give the cell its own copy instead.
    if (source.cellFormat.shading)
      newCell.cellFormat.shading = source.cellFormat.shading.cloneFormat();
    if (source.cellFormat.borders && newCell.cellFormat.borders)
      newCell.cellFormat.borders.copyFormat(source.cellFormat.borders);
  };
}
