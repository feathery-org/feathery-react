import internalState from '../../../utils/internalState';
import AssistantClient, { TableHandlers } from '../../AssistantClient';
import {
  dispatchDeleteTableRow,
  dispatchFocusTableCell,
  dispatchGetTableIssues,
  dispatchSetCellValidation,
  dispatchSetTableCellValue
} from '../tableMutations';
import { dispatchTriggerTableAction } from '../triggerTableAction';

const FORM = 'table-mutations-form';
const TABLE = 'hub_table';
const NAME_KEY = 'name';
const EMAIL_KEY = 'email';

const hubTable = {
  id: TABLE,
  properties: {
    data_source: 'hub',
    hub_id: 'hub1',
    enable_editing: true,
    add_delete_rows: true,
    columns: [
      { name: 'Name', hub_field_key: 'name' },
      { name: 'Email', hub_field_key: 'email' }
    ]
  }
};

const GRID_ALLOWS_ALL = {
  canEditCells: true,
  canAddRows: true,
  canDeleteRows: true
};

const seed = () => {
  const assistantClient = new AssistantClient({
    buttonOnClick: jest.fn(),
    runElementActions: jest.fn(),
    tableOnClick: jest.fn(),
    changeValue: jest.fn()
  });
  internalState[FORM] = {
    currentStep: { id: 'step-1', key: 'intro', tables: [hubTable] },
    fields: {},
    visiblePositions: {},
    assistantClient
  } as any;
  return assistantClient;
};

const mountTable = (
  assistantClient: AssistantClient,
  overrides: Partial<TableHandlers> = {}
) => {
  const handlers: TableHandlers = {
    handleCellEdit: jest.fn((_fieldKey, _rowIndex, value) => ({
      ok: true as const,
      value
    })),
    handleAddRow: jest.fn(),
    handleDeleteRow: jest.fn(),
    setIssues: jest.fn(() => []),
    clearIssues: jest.fn(),
    focusCell: jest.fn(() => ({ ok: true as const, rowIndex: 0 })),
    getIssues: jest.fn(() => ({ ok: true as const, cells: [] })),
    getLiveState: () => ({ rowCount: 3, ...GRID_ALLOWS_ALL }),
    getRow: (rowIndex: number) =>
      rowIndex < 3 ? { [EMAIL_KEY]: `row${rowIndex}@test.com` } : null,
    ...overrides
  };
  assistantClient.registerTable(TABLE, handlers);
  return handlers;
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('hub table row count', () => {
  it('comes from the mounted table, so setTableCellValue reaches hub rows', async () => {
    const handlers = mountTable(seed());

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 2, fieldKey: EMAIL_KEY, value: 'bob@test.com' }
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        ok: true,
        rowIndex: 2,
        fieldKey: EMAIL_KEY,
        priorValue: 'row2@test.com'
      })
    ]);
    expect(handlers.handleCellEdit).toHaveBeenCalledWith(
      EMAIL_KEY,
      2,
      'bob@test.com'
    );
  });

  it('reports the grid refusing a column instead of checking the stored columns itself', async () => {
    mountTable(seed(), {
      handleCellEdit: jest.fn(() => ({
        ok: false as const,
        errorType: 'read_only' as const,
        error: 'Column is read-only.'
      }))
    });

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 1, fieldKey: 'attachments', value: 'x' }
    ]);

    expect(results[0]).toMatchObject({ ok: false, errorType: 'read_only' });
  });

  it('refuses a write the mounted grid is not allowing right now', async () => {
    const handlers = mountTable(seed(), {
      getLiveState: () => ({ rowCount: 3 })
    });

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 0, fieldKey: EMAIL_KEY, value: 'x' }
    ]);

    expect(results[0]).toMatchObject({ ok: false, errorType: 'not_allowed' });
    expect(handlers.handleCellEdit).not.toHaveBeenCalled();
  });

  it('refuses the write when the table is not mounted, so no row is addressable', async () => {
    seed();

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 0, fieldKey: EMAIL_KEY, value: 'x' }
    ]);

    expect(results[0]).toMatchObject({
      ok: false,
      errorType: 'not_allowed'
    });
  });
});

describe('setCellValidation', () => {
  it('validates each finding, forwards the accepted ones normalized, and merges the grid rejections by index', async () => {
    const handlers = mountTable(seed(), {
      // The table finds no row for 'e9' and no column called 'nope'
      setIssues: jest.fn(() => [
        { index: 1, reason: 'row_not_shown' as const },
        { index: 2, reason: 'unknown_field' as const }
      ])
    });

    const result = await dispatchSetCellValidation(FORM, TABLE, [
      { rowIndex: 0, fieldKey: NAME_KEY, message: 'Looks misspelled' },
      { message: 'No target' },
      { entryId: 'e9', message: 'Entry gone' },
      { rowIndex: 7, message: 'Too far' },
      { rowIndex: 1, fieldKey: 'nope', message: 'Bad column' },
      { entryId: 'e2', message: 'Row-level', suggestedValue: 'Ann' }
    ]);

    expect(handlers.setIssues).toHaveBeenCalledWith([
      {
        target: { kind: 'cell', row: { rowIndex: 0 }, field: NAME_KEY },
        message: 'Looks misspelled'
      },
      {
        target: { kind: 'row', row: { entryId: 'e9' } },
        message: 'Entry gone'
      },
      {
        target: { kind: 'cell', row: { rowIndex: 1 }, field: 'nope' },
        message: 'Bad column'
      },
      {
        target: { kind: 'row', row: { entryId: 'e2' } },
        message: 'Row-level Suggested: Ann'
      }
    ]);
    expect(result).toMatchObject({ ok: true, applied: 2 });
    expect(
      (result as any).rejected.map((r: any) => [r.index, r.errorType])
    ).toEqual([
      [1, 'shape_mismatch'],
      [2, 'unknown_entry'],
      [3, 'row_out_of_range'],
      [4, 'unknown_field']
    ]);
  });


  it('treats a null or empty suggestedValue as no suggestion', async () => {
    const handlers = mountTable(seed());

    await dispatchSetCellValidation(FORM, TABLE, [
      { rowIndex: 0, message: 'Nothing suggested', suggestedValue: null },
      { rowIndex: 1, message: 'Blank suggested', suggestedValue: '' },
      { rowIndex: 2, message: 'Zero is a real value', suggestedValue: 0 }
    ]);

    const issues = (handlers.setIssues as jest.Mock).mock.calls[0][0];
    expect(issues.map((issue: any) => issue.message)).toEqual([
      'Nothing suggested',
      'Blank suggested',
      'Zero is a real value Suggested: 0'
    ]);
  });

  it('is not_mounted when the table has no spreadsheet grid to show findings', async () => {
    mountTable(seed(), { setIssues: () => null });

    const result = await dispatchSetCellValidation(FORM, TABLE, [
      { rowIndex: 0, message: 'Check this' }
    ]);

    expect(result).toMatchObject({ ok: false, errorType: 'not_mounted' });
  });
});

describe('focusTableCell', () => {
  it('forwards an entryId target and passes the grid outcome through', async () => {
    const hidden = {
      ok: false as const,
      errorType: 'row_hidden' as const,
      error: 'Row 1 is not shown.'
    };
    const handlers = mountTable(seed(), { focusCell: jest.fn(() => hidden) });

    const result = await dispatchFocusTableCell(FORM, TABLE, {
      entryId: 'e2',
      fieldKey: NAME_KEY
    });

    expect(handlers.focusCell).toHaveBeenCalledWith({
      entryId: 'e2',
      fieldKey: NAME_KEY
    });
    expect(result).toEqual(hidden);
  });

  it('checks the target shape and row range before dispatching', async () => {
    const handlers = mountTable(seed());

    expect(
      await dispatchFocusTableCell(FORM, TABLE, { fieldKey: NAME_KEY })
    ).toMatchObject({ ok: false, errorType: 'shape_mismatch' });
    expect(
      await dispatchFocusTableCell(FORM, TABLE, {
        rowIndex: 5,
        fieldKey: NAME_KEY
      })
    ).toMatchObject({ ok: false, errorType: 'row_out_of_range' });
    expect(handlers.focusCell).not.toHaveBeenCalled();
  });

  it('reads the whole table on scope table no matter what row fields ride along', async () => {
    const handlers = mountTable(seed());

    await dispatchGetTableIssues(FORM, TABLE, {
      scope: 'table',
      rowIndex: 999999,
      entryId: ''
    });
    await dispatchGetTableIssues(FORM, TABLE, { scope: 'row', entryId: 'e2' });

    expect(handlers.getIssues).toHaveBeenNthCalledWith(1, undefined);
    expect(handlers.getIssues).toHaveBeenNthCalledWith(2, { entryId: 'e2' });
    expect(
      await dispatchGetTableIssues(FORM, TABLE, { scope: 'row', rowIndex: 9 })
    ).toMatchObject({ ok: false, errorType: 'row_out_of_range' });
  });

  it('targets the whole row when fieldKey is omitted or empty', async () => {
    const handlers = mountTable(seed());

    await dispatchFocusTableCell(FORM, TABLE, { rowIndex: 0, fieldKey: '' });

    expect(handlers.focusCell).toHaveBeenCalledWith({ rowIndex: 0 });
  });

  it('is not_mounted when no table is registered', async () => {
    seed();

    const result = await dispatchFocusTableCell(FORM, TABLE, {
      entryId: 'e1',
      fieldKey: NAME_KEY
    });

    expect(result).toMatchObject({ ok: false, errorType: 'not_mounted' });
  });
});

describe('a row waiting to be deleted', () => {
  const mountWithDeletion = () =>
    mountTable(seed(), {
      getLiveState: () => ({
        rowCount: 3,
        ...GRID_ALLOWS_ALL,
        pendingDeletions: [{ rowIndex: 1, entryId: 'entry2' }]
      })
    });

  it('is refused by every tool that targets it by row index', async () => {
    mountWithDeletion();

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 1, fieldKey: EMAIL_KEY, value: 'x' }
    ]);
    expect(results[0]).toMatchObject({ ok: false, errorType: 'row_deleted' });

    await expect(
      dispatchDeleteTableRow(FORM, TABLE, 1)
    ).resolves.toMatchObject({ ok: false, errorType: 'row_deleted' });
    await expect(
      dispatchFocusTableCell(FORM, TABLE, { rowIndex: 1, fieldKey: EMAIL_KEY })
    ).resolves.toMatchObject({ ok: false, errorType: 'row_deleted' });
    await expect(
      dispatchGetTableIssues(FORM, TABLE, { scope: 'row', rowIndex: 1 })
    ).resolves.toMatchObject({ ok: false, errorType: 'row_deleted' });
    await expect(
      dispatchTriggerTableAction(FORM, TABLE, 1, undefined)
    ).resolves.toMatchObject({ ok: false, errorType: 'row_deleted' });
  });

  it('is refused when named by its hub entry instead of its index', async () => {
    mountWithDeletion();

    await expect(
      dispatchFocusTableCell(FORM, TABLE, { entryId: 'entry2' })
    ).resolves.toMatchObject({ ok: false, errorType: 'row_deleted' });
    await expect(
      dispatchSetCellValidation(FORM, TABLE, [
        { entryId: 'entry2', fieldKey: EMAIL_KEY, message: 'Check this' }
      ])
    ).resolves.toMatchObject({
      ok: true,
      applied: 0,
      rejected: [{ index: 0, errorType: 'row_deleted' }]
    });
  });

  it('leaves the rows around it addressable', async () => {
    mountWithDeletion();

    const { results } = await dispatchSetTableCellValue(FORM, TABLE, [
      { rowIndex: 2, fieldKey: EMAIL_KEY, value: 'x' }
    ]);

    expect(results[0]).toMatchObject({ ok: true, rowIndex: 2 });
  });
});
