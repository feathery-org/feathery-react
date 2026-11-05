import internalState from '../../internalState';
import {
  addTableRow,
  deleteTableRow,
  focusTableCell,
  getTableIssues,
  getTableRows,
  setTableCells,
  setTableFindings,
  TableCellIssue,
  TableHandlers,
  TableLiveState,
  triggerTableAction
} from '../tables';
import * as formActionUtils from '../utils';

// The dispatchers gate on the mounted grid's live state and shape its answers, the grid itself is stubbed
describe('table form actions', () => {
  const formUuid = 'form-tables-test';
  const TABLE = 'table1';
  const ROWS: Array<Record<string, unknown>> = [
    { name: 'Alice', email: 'alice@x.io' },
    { name: 'Bob', email: 'bob@x.io' }
  ];

  const liveState = (over: Partial<TableLiveState> = {}): TableLiveState => ({
    columns: [
      { name: 'Name', fieldKey: 'name' },
      { name: 'Email', fieldKey: 'email', readOnly: true }
    ],
    rowCount: ROWS.length,
    canEditCells: true,
    canAddRows: true,
    canDeleteRows: true,
    showsActions: true,
    allowsRowClick: false,
    buffersEdits: false,
    showsGrid: false,
    ...over
  });

  const makeHandlers = (
    live: TableLiveState = liveState(),
    over: Partial<TableHandlers> = {}
  ): TableHandlers => ({
    getLiveState: () => live,
    getRow: (rowIndex) => ROWS[rowIndex] ?? null,
    getRows: jest.fn(({ offset, limit }) => ({
      rowCount: ROWS.length,
      rows: ROWS.slice(offset, offset + limit).map((values, i) => ({
        rowIndex: offset + i,
        values
      }))
    })),
    editCells: jest.fn((writes) =>
      writes.map((write) => ({ ok: true as const, value: write.value }))
    ),
    addRow: jest.fn(() => 0),
    deleteRow: jest.fn(),
    runAction: jest.fn(async () => {}),
    setFindings: jest.fn(() => []),
    focusCell: jest.fn(() => ({ ok: true as const })),
    getIssues: jest.fn(() => []),
    ...over
  });

  const makeState = (
    handlers?: TableHandlers,
    over: Record<string, any> = {}
  ) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        tables: [
          {
            id: TABLE,
            position: [0],
            properties: { actions: [{ label: 'Send' }] }
          }
        ]
      },
      visiblePositions: {},
      inlineErrors: {},
      formSettings: {},
      ...(handlers ? { tables: new Map([[TABLE, handlers]]) } : {}),
      ...over
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  let markInteraction: jest.SpyInstance;
  beforeEach(() => {
    markInteraction = jest
      .spyOn(formActionUtils, 'markInteraction')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    delete (internalState as any)[formUuid];
    markInteraction.mockRestore();
  });

  describe('first interaction', () => {
    it('counts every table write as the person interacting with the form', async () => {
      makeState(makeHandlers());

      setTableCells(formUuid, TABLE, [
        { rowIndex: 0, fieldKey: 'name', value: 'Al' }
      ]);
      addTableRow(formUuid, TABLE);
      deleteTableRow(formUuid, TABLE, { rowIndex: 1 });
      await triggerTableAction(formUuid, TABLE, { rowIndex: 0 }, 'Send');

      expect(markInteraction).toHaveBeenCalledTimes(4);
    });

    it('does not count a write the table refuses', () => {
      makeState(
        makeHandlers(
          liveState({
            canEditCells: false,
            canAddRows: false,
            canDeleteRows: false
          })
        )
      );

      setTableCells(formUuid, TABLE, [
        { rowIndex: 0, fieldKey: 'name', value: 'Al' }
      ]);
      addTableRow(formUuid, TABLE);
      deleteTableRow(formUuid, TABLE, { rowIndex: 0 });

      expect(markInteraction).not.toHaveBeenCalled();
    });
  });

  describe('finding the table', () => {
    it('reports a form that has not loaded', () => {
      expect(getTableRows(formUuid, TABLE)).toEqual({
        ok: false,
        reason: 'not_loaded',
        message: expect.any(String)
      });
    });

    it('rejects a table that is not on the step, hidden, or not mounted', () => {
      makeState(makeHandlers());
      expect(setTableCells(formUuid, 'other', [])).toMatchObject({
        ok: false,
        reason: 'not_on_step'
      });

      makeState(makeHandlers(), { visiblePositions: { '0': [false] } });
      expect(addTableRow(formUuid, TABLE)).toMatchObject({
        ok: false,
        reason: 'hidden'
      });

      makeState();
      expect(deleteTableRow(formUuid, TABLE, { rowIndex: 0 })).toMatchObject({
        ok: false,
        reason: 'not_mounted'
      });
    });
  });

  describe('getTableRows', () => {
    it('reads the grid with a capped page and the trimmed search', () => {
      const handlers = makeHandlers();
      makeState(handlers);

      const result = getTableRows(formUuid, TABLE, {
        offset: 1,
        limit: 500,
        search: '  bob '
      });

      expect(handlers.getRows).toHaveBeenCalledWith({
        offset: 1,
        limit: 50,
        search: 'bob'
      });
      expect(result).toEqual({
        ok: true,
        rowCount: 2,
        offset: 1,
        rows: [{ rowIndex: 1, values: ROWS[1] }]
      });
    });
  });

  describe('setTableCells', () => {
    it('refuses every cell when the grid does not allow editing', () => {
      const handlers = makeHandlers(liveState({ canEditCells: false }));
      makeState(handlers);

      expect(
        setTableCells(formUuid, TABLE, [
          { rowIndex: 0, fieldKey: 'name', value: 'Al' }
        ])
      ).toMatchObject({ ok: false, reason: 'not_allowed' });
      expect(handlers.editCells).not.toHaveBeenCalled();
    });

    it('gives every cell one verdict in input order, writing only the rows it could resolve', () => {
      const handlers = makeHandlers(liveState(), {
        editCells: jest.fn((writes) =>
          writes.map((write) =>
            write.fieldKey === 'email'
              ? {
                  ok: false as const,
                  reason: 'read_only' as const,
                  message: 'Read only.'
                }
              : { ok: true as const, value: write.value }
          )
        )
      });
      makeState(handlers);

      const result = setTableCells(formUuid, TABLE, [
        { rowIndex: 0, fieldKey: 'name', value: 'Al' },
        { rowIndex: 5, fieldKey: 'name', value: 'Nobody' },
        { rowIndex: 1, fieldKey: 'email', value: 'x' },
        { rowIndex: 1, fieldKey: 'name', value: 'Bobby' }
      ]);

      expect(handlers.editCells).toHaveBeenCalledTimes(1);
      expect(handlers.editCells).toHaveBeenCalledWith([
        { rowIndex: 0, fieldKey: 'name', value: 'Al' },
        { rowIndex: 1, fieldKey: 'email', value: 'x' },
        { rowIndex: 1, fieldKey: 'name', value: 'Bobby' }
      ]);
      expect(result).toEqual({
        ok: true,
        applied: [
          { rowIndex: 0, fieldKey: 'name', value: 'Al', priorValue: 'Alice' },
          { rowIndex: 1, fieldKey: 'name', value: 'Bobby', priorValue: 'Bob' }
        ],
        rejected: [
          {
            rowIndex: 5,
            fieldKey: 'name',
            reason: 'unknown_row',
            message: expect.stringContaining('out of range')
          },
          {
            rowIndex: 1,
            fieldKey: 'email',
            reason: 'read_only',
            message: 'Read only.'
          }
        ]
      });
    });

    it('addresses hub rows by entry id and marks buffered writes pending', () => {
      const handlers = makeHandlers(
        liveState({ entryIds: ['e1', null], buffersEdits: true })
      );
      makeState(handlers);

      const result = setTableCells(formUuid, TABLE, [
        { entryId: 'e1', rowIndex: 1, fieldKey: 'name', value: 'Al' },
        { rowIndex: 1, fieldKey: 'name', value: 'Bobby' },
        { entryId: 'gone', fieldKey: 'name', value: 'x' },
        { fieldKey: 'name', value: 'x' }
      ]);

      expect(result).toMatchObject({
        applied: [
          { rowIndex: 0, entryId: 'e1', value: 'Al', pending: true },
          { rowIndex: 1, entryId: null, value: 'Bobby', pending: true }
        ],
        rejected: [
          {
            entryId: 'gone',
            reason: 'unknown_row',
            message: expect.stringContaining('filter')
          },
          { fieldKey: 'name', reason: 'unknown_row' }
        ]
      });
    });
  });

  describe('sensitive values', () => {
    const SSN_ROWS = [{ name: 'Alice', ssn: '123456789' }];
    const steps = {
      'step-1': { servar_fields: [{ servar: { key: 'ssn', type: 'ssn' } }] }
    };
    const sensitiveHandlers = () =>
      makeHandlers(liveState(), {
        getRow: (rowIndex) => SSN_ROWS[rowIndex] ?? null,
        getRows: jest.fn(() => ({
          rowCount: 1,
          rows: [{ rowIndex: 0, values: SSN_ROWS[0] }]
        }))
      });

    it('masks sensitive cells in the rows it reads', () => {
      makeState(sensitiveHandlers(), { steps });

      expect(getTableRows(formUuid, TABLE)).toMatchObject({
        rows: [{ rowIndex: 0, values: { name: 'Alice', ssn: '••••6789' } }]
      });
    });

    it('refuses a masked value and masks the values it reports', () => {
      const handlers = sensitiveHandlers();
      makeState(handlers, { steps });

      const result = setTableCells(formUuid, TABLE, [
        { rowIndex: 0, fieldKey: 'ssn', value: '••••6789' },
        { rowIndex: 0, fieldKey: 'ssn', value: '987654321' }
      ]);

      expect(handlers.editCells).toHaveBeenCalledWith([
        { rowIndex: 0, fieldKey: 'ssn', value: '987654321' }
      ]);
      expect(result).toEqual({
        ok: true,
        applied: [
          {
            rowIndex: 0,
            fieldKey: 'ssn',
            value: '••••4321',
            priorValue: '••••6789'
          }
        ],
        rejected: [
          expect.objectContaining({ fieldKey: 'ssn', reason: 'invalid_value' })
        ]
      });
    });

    it('masks the sensitive values a table issue group reports', () => {
      makeState(
        makeHandlers(liveState({ showsGrid: true }), {
          getRow: (rowIndex) => SSN_ROWS[rowIndex] ?? null,
          getIssues: jest.fn(() => [
            {
              rowIndex: 0,
              fieldKey: 'ssn',
              message: 'Invalid',
              severity: 'error' as const,
              source: 'rule' as const
            }
          ])
        }),
        { steps }
      );

      expect(getTableIssues(formUuid, TABLE, { scope: 'table' })).toMatchObject(
        { groups: [{ fieldKey: 'ssn', rows: [{ rowIndex: 0, value: '••••6789' }] }] }
      );
    });
  });

  describe('addTableRow', () => {
    it('refuses when the grid does not allow it', () => {
      makeState(makeHandlers(liveState({ canAddRows: false })));
      expect(addTableRow(formUuid, TABLE)).toMatchObject({
        ok: false,
        reason: 'not_allowed'
      });
    });

    it('reports where the grid put the row and the new count', () => {
      const handlers = makeHandlers(liveState(), { addRow: jest.fn(() => 2) });
      makeState(handlers);

      expect(addTableRow(formUuid, TABLE)).toEqual({
        ok: true,
        rowIndex: 2,
        rowCount: 3
      });
      expect(handlers.addRow).toHaveBeenCalledTimes(1);
    });

    it('names a fresh hub row with a null entry id and a buffered one pending', () => {
      makeState(
        makeHandlers(liveState({ entryIds: ['e1', 'e2'], buffersEdits: true }))
      );

      expect(addTableRow(formUuid, TABLE)).toEqual({
        ok: true,
        rowIndex: 0,
        entryId: null,
        rowCount: 3,
        pending: true
      });
    });
  });

  describe('deleteTableRow', () => {
    it('refuses when the grid does not allow it or the row is unknown', () => {
      const handlers = makeHandlers(liveState({ canDeleteRows: false }));
      makeState(handlers);
      expect(deleteTableRow(formUuid, TABLE, { rowIndex: 0 })).toMatchObject({
        ok: false,
        reason: 'not_allowed'
      });

      makeState(makeHandlers());
      expect(deleteTableRow(formUuid, TABLE, { rowIndex: 9 })).toMatchObject({
        ok: false,
        reason: 'unknown_row'
      });
    });

    it('refuses a row already waiting on the save', () => {
      const handlers = makeHandlers(liveState({ buffersEdits: true }), {
        getRow: () => null
      });
      makeState(handlers);

      expect(deleteTableRow(formUuid, TABLE, { rowIndex: 1 })).toMatchObject({
        ok: false,
        reason: 'row_deleted'
      });
      expect(handlers.deleteRow).not.toHaveBeenCalled();
    });

    it('removes the row now, or holds it with its slot when the table buffers', () => {
      const handlers = makeHandlers();
      makeState(handlers);
      expect(deleteTableRow(formUuid, TABLE, { rowIndex: 1 })).toEqual({
        ok: true,
        rowIndex: 1,
        rowCount: 1
      });
      expect(handlers.deleteRow).toHaveBeenCalledWith(1);

      makeState(
        makeHandlers(liveState({ buffersEdits: true, entryIds: ['e1', 'e2'] }))
      );
      expect(deleteTableRow(formUuid, TABLE, { entryId: 'e2' })).toEqual({
        ok: true,
        rowIndex: 1,
        entryId: 'e2',
        rowCount: 2,
        pending: true
      });
    });
  });

  describe('triggerTableAction', () => {
    it('refuses an action the table does not offer and clicks it cannot take', async () => {
      makeState(makeHandlers());
      await expect(
        triggerTableAction(formUuid, TABLE, { rowIndex: 0 }, 'Pay')
      ).resolves.toMatchObject({ ok: false, reason: 'unknown_action' });
      await expect(
        triggerTableAction(formUuid, TABLE, { rowIndex: 0 })
      ).resolves.toMatchObject({ ok: false, reason: 'not_allowed' });

      makeState(makeHandlers(liveState({ showsActions: false })));
      await expect(
        triggerTableAction(formUuid, TABLE, { rowIndex: 0 }, 'Send')
      ).resolves.toMatchObject({ ok: false, reason: 'not_allowed' });
    });

    it('runs the action on the resolved row and reports the step change and new errors', async () => {
      const handlers = makeHandlers(liveState({ entryIds: ['e1', 'e2'] }), {
        runAction: jest.fn(async () => {
          state.latestStepName = 'step-2';
          state.inlineErrors = { name: { message: 'Required' } };
        })
      });
      const state = makeState(handlers);

      await expect(
        triggerTableAction(formUuid, TABLE, { entryId: 'e2' }, 'Send')
      ).resolves.toEqual({
        ok: true,
        navigated: { fromStepKey: 'step-1', toStepKey: 'step-2' },
        fieldErrors: [{ key: 'name', message: 'Required' }]
      });
      expect(handlers.runAction).toHaveBeenCalledWith(1, 'Send');
    });

    it('allows a bare row click only where the person could click, and reports a thrown action', async () => {
      const handlers = makeHandlers(liveState({ allowsRowClick: true }), {
        runAction: jest.fn(async () => {
          throw new Error('boom');
        })
      });
      makeState(handlers);

      await expect(
        triggerTableAction(formUuid, TABLE, { rowIndex: 0 })
      ).resolves.toEqual({
        ok: false,
        reason: 'action_failed',
        message: 'boom'
      });
      expect(handlers.runAction).toHaveBeenCalledWith(0, undefined);
    });
  });

  describe('setTableFindings', () => {
    it('refuses a table that is not showing a grid', () => {
      makeState(makeHandlers());
      expect(setTableFindings(formUuid, TABLE, [])).toMatchObject({
        ok: false,
        reason: 'table_not_shown'
      });
    });

    it('places what it can, folds a suggestion into the message, and reports every rejection by position', () => {
      const handlers = makeHandlers(
        liveState({ showsGrid: true, entryIds: ['e1', 'e2'] }),
        {
          getRow: (rowIndex) => (rowIndex === 1 ? null : ROWS[rowIndex]),
          setFindings: jest.fn(() => [
            { index: 1, reason: 'unknown_column', message: 'no phone' }
          ])
        }
      );
      makeState(handlers);

      const result = setTableFindings(formUuid, TABLE, [
        { entryId: 'e9', message: 'gone' },
        { rowIndex: 1, message: 'deleted' },
        { rowIndex: 0, fieldKey: 'name', message: 'Fix.', suggestedValue: 'Al' },
        { rowIndex: 0, fieldKey: 'phone', message: 'No column' },
        { rowIndex: 0, fieldKey: '', message: 'Whole row' }
      ]);

      expect(handlers.setFindings).toHaveBeenCalledWith([
        { rowIndex: 0, fieldKey: 'name', message: 'Fix. Suggested: Al' },
        { rowIndex: 0, fieldKey: 'phone', message: 'No column' },
        { rowIndex: 0, message: 'Whole row' }
      ]);
      expect(result).toEqual({
        ok: true,
        applied: 2,
        rejected: [
          { index: 0, reason: 'unknown_row', message: expect.any(String) },
          { index: 1, reason: 'row_deleted', message: expect.any(String) },
          { index: 3, reason: 'unknown_column', message: 'no phone' }
        ]
      });
    });
  });

  describe('focusTableCell', () => {
    it('focuses the resolved row and passes the grid refusal through', () => {
      const handlers = makeHandlers(
        liveState({ showsGrid: true, entryIds: ['e1', 'e2'] }),
        {
          focusCell: jest.fn((rowIndex) =>
            rowIndex === 1
              ? { ok: false as const, reason: 'row_hidden' as const, message: 'hidden' }
              : { ok: true as const }
          )
        }
      );
      makeState(handlers);

      expect(
        focusTableCell(formUuid, TABLE, { entryId: 'e1', fieldKey: 'name' })
      ).toEqual({ ok: true, rowIndex: 0, entryId: 'e1' });
      expect(handlers.focusCell).toHaveBeenCalledWith(0, 'name');
      expect(focusTableCell(formUuid, TABLE, { rowIndex: 1 })).toEqual({
        ok: false,
        reason: 'row_hidden',
        message: 'hidden'
      });
      expect(focusTableCell(formUuid, TABLE, { rowIndex: 5 })).toMatchObject({
        ok: false,
        reason: 'unknown_row'
      });

      makeState(makeHandlers());
      expect(focusTableCell(formUuid, TABLE, { rowIndex: 0 })).toMatchObject({
        ok: false,
        reason: 'table_not_shown'
      });
    });
  });

  describe('getTableIssues', () => {
    const ruleError = (rowIndex: number): TableCellIssue => ({
      rowIndex,
      fieldKey: 'email',
      columnName: 'Email',
      message: 'Must be a number',
      severity: 'error',
      source: 'rule'
    });
    const ISSUES: TableCellIssue[] = [
      ...Array.from({ length: 60 }, (_, rowIndex) => ruleError(rowIndex)),
      {
        rowIndex: 1,
        message: 'Row looks wrong',
        severity: 'warning',
        source: 'assistant'
      }
    ];

    it('reads one row cell by cell, or the whole table grouped by what is wrong with its rows capped, each with its flagged value', () => {
      const handlers = makeHandlers(
        liveState({ showsGrid: true, rowCount: 60 }),
        {
          getRow: (rowIndex) => ({ email: rowIndex }),
          getIssues: jest.fn((rowIndex?: number) =>
            rowIndex === undefined
              ? ISSUES
              : ISSUES.filter((issue) => issue.rowIndex === rowIndex)
          )
        }
      );
      makeState(handlers);

      expect(
        getTableIssues(formUuid, TABLE, { scope: 'row', rowIndex: 1 })
      ).toEqual({
        ok: true,
        rowIndex: 1,
        issues: [
          {
            fieldKey: 'email',
            columnName: 'Email',
            message: 'Must be a number',
            severity: 'error',
            source: 'rule',
            value: 1
          },
          { message: 'Row looks wrong', severity: 'warning', source: 'assistant' }
        ]
      });

      const grouped = getTableIssues(formUuid, TABLE, { scope: 'table' });
      expect(grouped).toMatchObject({ ok: true, total: 61 });
      const { groups } = grouped as { groups: any[] };
      expect(groups).toHaveLength(2);
      expect(groups[0]).toMatchObject({
        fieldKey: 'email',
        message: 'Must be a number',
        count: 60
      });
      expect(groups[0].rows).toHaveLength(50);
      expect(groups[0].rows[2]).toEqual({ rowIndex: 2, value: 2 });
      expect(groups[1]).toMatchObject({
        message: 'Row looks wrong',
        count: 1,
        rows: [{ rowIndex: 1 }]
      });

      expect(
        getTableIssues(formUuid, TABLE, { scope: 'row', rowIndex: 99 })
      ).toMatchObject({ ok: false, reason: 'unknown_row' });
    });
  });
});
