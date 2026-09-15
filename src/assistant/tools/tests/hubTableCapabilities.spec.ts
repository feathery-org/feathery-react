import { getTableCapabilities } from '../utils';

describe('hub-backed table capabilities', () => {
  it('withholds every mutation capability even when editing is enabled', () => {
    const hubTable = {
      properties: {
        data_source: 'hub',
        enable_editing: true,
        add_delete_rows: true
      }
    };

    expect(getTableCapabilities(hubTable, 0)).toEqual({
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
