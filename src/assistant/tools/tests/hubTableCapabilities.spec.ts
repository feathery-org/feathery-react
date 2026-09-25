import { getTableCapabilities } from '../utils';

const GRID_ALLOWS_ALL = {
  rowCount: 4,
  canEditCells: true,
  canAddRows: true,
  canDeleteRows: true
};

describe('hub-backed table capabilities', () => {
  const hubTable = {
    properties: {
      data_source: 'hub',
      enable_editing: true,
      add_delete_rows: true
    }
  };

  it('withholds every mutation capability while the grid is not mounted', () => {
    expect(getTableCapabilities(hubTable, 0)).toEqual({
      canEditCells: false,
      canAddRows: false,
      canDeleteRows: false
    });
  });

  it('grants what the mounted grid allows', () => {
    expect(getTableCapabilities(hubTable, 4, GRID_ALLOWS_ALL)).toEqual({
      canEditCells: true,
      canAddRows: true,
      canDeleteRows: true
    });
  });

  it('follows the mounted grid over the stored settings', () => {
    const transposedSpreadsheet = {
      properties: { ...hubTable.properties, transpose: true }
    };

    expect(
      getTableCapabilities(transposedSpreadsheet, 4, GRID_ALLOWS_ALL)
    ).toEqual({ canEditCells: true, canAddRows: true, canDeleteRows: true });
    expect(getTableCapabilities(hubTable, 4, { rowCount: 4 })).toEqual({
      canEditCells: false,
      canAddRows: false,
      canDeleteRows: false
    });
  });

  it('leaves a field-backed table with the capabilities its settings grant', () => {
    const fieldTable = {
      properties: { enable_editing: true, add_delete_rows: true }
    };

    expect(getTableCapabilities(fieldTable, 3)).toEqual({
      canEditCells: true,
      canAddRows: true,
      canDeleteRows: true
    });
  });
});
