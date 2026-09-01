// Public, user-targetable class names for the parts of the table element.
//
// These are a documented, stable API: form builders write custom CSS against
// them (e.g. `.feathery-table-cell { ... }`).
//
// Treat renames/removals as breaking changes to customer CSS.
export const TABLE_CLASS = {
  container: 'feathery-table-container',
  toolbar: 'feathery-table-toolbar',
  search: 'feathery-table-search',
  searchInput: 'feathery-table-search-input',
  addRowButton: 'feathery-table-add-row-button',
  error: 'feathery-table-error',
  table: 'feathery-table',
  header: 'feathery-table-header',
  headerCell: 'feathery-table-header-cell',
  sortIcon: 'feathery-table-sort-icon',
  body: 'feathery-table-body',
  row: 'feathery-table-row',
  cell: 'feathery-table-cell',
  editableCell: 'feathery-table-editable-cell',
  cellInput: 'feathery-table-cell-input',
  actionButton: 'feathery-table-action-button',
  actionMenuButton: 'feathery-table-action-menu-button',
  actionMenu: 'feathery-table-action-menu',
  actionMenuItem: 'feathery-table-action-menu-item',
  deleteButton: 'feathery-table-delete-button',
  deleteConfirm: 'feathery-table-delete-confirm',
  pagination: 'feathery-table-pagination',
  pageButton: 'feathery-table-page-button',
  pageSelect: 'feathery-table-page-select',
  empty: 'feathery-table-empty',

  // Spreadsheet display mode. This mode renders an ARIA grid of divs rather
  // than a <table>, so it has its own class names — CSS written against
  // `.feathery-table` and its children does not apply here.
  grid: 'feathery-table-grid',
  gridHeader: 'feathery-table-grid-header',
  gridHeaderCell: 'feathery-table-grid-header-cell',
  gridCornerHeader: 'feathery-table-grid-corner',
  gridRow: 'feathery-table-grid-row',
  gridRowNumber: 'feathery-table-grid-row-number',
  gridCell: 'feathery-table-grid-cell',
  gridCellEditor: 'feathery-table-grid-cell-input',
  gridColumnResizer: 'feathery-table-grid-column-resizer',
  gridFillHandle: 'feathery-table-grid-fill-handle',
  gridRowMenu: 'feathery-table-grid-row-menu',
  gridRowMenuItem: 'feathery-table-grid-row-menu-item',
  gridAddRow: 'feathery-table-grid-add-row'
} as const;
