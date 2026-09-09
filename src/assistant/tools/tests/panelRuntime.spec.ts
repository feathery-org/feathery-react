import internalState from '../../../utils/internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';

const FORM = 'panel-runtime-form';

afterEach(() => {
  delete (internalState as any)[FORM];
});

it('normalizes runtime-only values at the panelRuntime source and retains empty hidden keys', () => {
  const file = new File(['policy'], 'policy.pdf', {
    type: 'application/pdf'
  });
  const pending = Promise.resolve('runtime only');
  const currentStep = {
    id: 'step-1',
    key: 'intro',
    subgrids: [],
    texts: [],
    images: [],
    buttons: [],
    tables: [],
    tabs: [],
    progress_bars: [],
    next_conditions: [],
    servar_fields: [
      {
        servar: { id: 'field-1', key: 'upload', type: 'file_upload' },
        properties: {},
        position: []
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { intro: currentStep },
    fields: {
      upload: { value: { file, nested: { pending } } },
      hidden_file: { value: file },
      hidden_null: { value: null },
      hidden_empty_string: { value: '' },
      hidden_empty_array: { value: [] }
    },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM)!;

  const filePresence = {
    kind: 'file',
    present: true,
    name: 'policy.pdf',
    type: 'application/pdf',
    size: 6
  };
  expect(snapshot.values.upload).toEqual({
    file: filePresence,
    nested: { pending: { kind: 'promise', present: true } }
  });
  expect(snapshot.currentStepFields[0].value).toEqual(snapshot.values.upload);
  expect(snapshot.hiddenFieldValues).toEqual({ hidden_file: filePresence });
  expect(snapshot.hiddenFieldsEmpty).toEqual([
    'hidden_null',
    'hidden_empty_string',
    'hidden_empty_array'
  ]);
  expect(snapshot.hiddenFieldValues).not.toHaveProperty('not_present');
  expect(snapshot.hiddenFieldsEmpty).not.toContain('not_present');
  expect(() => JSON.stringify(snapshot)).not.toThrow();
});

const emptyStep = (tables: any[] = []) => ({
  id: 'step-1',
  key: 'intro',
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables,
  tabs: [],
  progress_bars: [],
  next_conditions: [],
  servar_fields: []
});

it('caps hiddenFieldsEmpty at 50 keys and reports the total only when truncated', () => {
  const fields: Record<string, { value: null }> = {};
  for (let i = 0; i < 60; i++) fields[`hidden_${i}`] = { value: null };
  (internalState as any)[FORM] = {
    currentStep: emptyStep(),
    steps: {},
    fields,
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM)!;

  expect(snapshot.hiddenFieldsEmpty).toHaveLength(50);
  expect(snapshot.hiddenFieldsEmpty[0]).toBe('hidden_0');
  expect(snapshot.hiddenFieldsEmptyTotal).toBe(60);

  (internalState as any)[FORM].fields = { hidden_0: { value: null } };
  expect(getPanelRuntimeSnapshot(FORM)).not.toHaveProperty(
    'hiddenFieldsEmptyTotal'
  );
});

it('spreads a mounted table live state into its entry and takes its capabilities from it', () => {
  const hubTable = {
    id: 'hub_table',
    properties: {
      data_source: 'hub',
      hub_id: 'hub1',
      enable_editing: true,
      columns: [{ name: 'Name', hub_field_key: 'name' }]
    }
  };
  const liveState = {
    rowCount: 2,
    canEditCells: true,
    selection: {
      rowIndex: 1,
      entryId: 'entry2',
      fieldKey: 'name',
      columnName: 'Name',
      value: 'Bob',
      row: { name: 'Bob' }
    },
    viewport: { visibleRowIndexes: [0, 1] },
    findings: 1
  };
  (internalState as any)[FORM] = {
    currentStep: emptyStep([hubTable]),
    steps: {},
    fields: {},
    visiblePositions: {},
    inlineErrors: {},
    logicRules: [],
    assistantClient: {
      getTableColumns: () => null,
      getTableLiveState: (tableId: string) =>
        tableId === 'hub_table' ? liveState : null
    }
  };

  const [entry] = getPanelRuntimeSnapshot(FORM)!.currentStepTables;

  expect(entry).toEqual({
    id: 'hub_table',
    hubId: 'hub1',
    columns: [{ name: 'Name', fieldKey: 'name' }],
    canEditCells: true,
    visible: true,
    ...liveState
  });
});
