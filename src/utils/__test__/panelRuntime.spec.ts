import internalState from '../internalState';
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

describe('tables in the snapshot', () => {
  const stepWithTables = (tables: any[]) => ({
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
  const fieldTable = {
    id: 'tbl-field',
    position: [0],
    properties: {
      columns: [
        { name: 'Name', field_key: 'name_key' },
        { name: 'Age', field_key: 'age_key' }
      ],
      actions: [{ label: 'Send' }],
      enable_editing: true,
      add_delete_rows: true
    }
  };
  const hubTable = {
    id: 'tbl-hub',
    position: [1],
    properties: {
      columns: [{ name: 'Name', hub_field_key: 'name' }],
      data_source: 'hub',
      hub_dynamic: true,
      hub_id_field_key: 'which_hub'
    }
  };
  const names = Array.from({ length: 12 }, (_, i) => `Person ${i}`);
  const mountedHandlers = (over: Record<string, any>) => ({
    getLiveState: () => ({
      columns: [{ name: 'Name', fieldKey: 'name_key' }],
      rowCount: 0,
      canEditCells: false,
      canAddRows: false,
      canDeleteRows: false,
      showsActions: false,
      allowsRowClick: false,
      buffersEdits: false,
      ...over
    }),
    getRows: ({ limit }: { limit: number }) => ({
      rowCount: names.length,
      rows: names
        .slice(0, limit)
        .map((name, rowIndex) => ({ rowIndex, values: { name_key: name } }))
    })
  });

  it('falls back to stored props for an unmounted table, with nothing allowed and the field rows capped', () => {
    (internalState as any)[FORM] = {
      currentStep: stepWithTables([fieldTable, hubTable]),
      fields: { name_key: { value: names }, age_key: { value: [1, 2] } },
      visiblePositions: {},
      inlineErrors: {},
      logicRules: []
    };

    const [field, hub] = getPanelRuntimeSnapshot(FORM)!.currentStepTables;

    expect(field).toEqual({
      id: 'tbl-field',
      columns: [
        { name: 'Name', fieldKey: 'name_key' },
        { name: 'Age', fieldKey: 'age_key' }
      ],
      rowCount: 12,
      rows: names.slice(0, 10).map((name, i) => [name, i < 2 ? i + 1 : null]),
      rowsOmitted: 2,
      actions: [{ label: 'Send' }],
      visible: true
    });
    expect(hub).toEqual({
      id: 'tbl-hub',
      columns: [{ name: 'Name', fieldKey: 'name' }],
      rowCount: 0,
      visible: true
    });
  });

  it('takes a mounted table from its grid, with hub rows left out and the resolved hub named', () => {
    (internalState as any)[FORM] = {
      currentStep: stepWithTables([fieldTable, hubTable]),
      fields: {},
      visiblePositions: {},
      inlineErrors: {},
      logicRules: [],
      tables: new Map<string, any>([
        [
          'tbl-field',
          mountedHandlers({
            rowCount: names.length,
            canEditCells: true,
            canAddRows: true,
            showsActions: false,
            buffersEdits: true,
            pending: { edits: 1, deletions: 0 }
          })
        ],
        [
          'tbl-hub',
          mountedHandlers({
            hubId: 'hub-resolved',
            columns: [{ name: 'Name', fieldKey: 'name', readOnly: true }],
            rowCount: 185,
            canEditCells: true,
            entryIds: []
          })
        ]
      ])
    };

    const [field, hub] = getPanelRuntimeSnapshot(FORM)!.currentStepTables;

    expect(field).toEqual({
      id: 'tbl-field',
      columns: [{ name: 'Name', fieldKey: 'name_key' }],
      rowCount: 12,
      rows: names.slice(0, 10).map((name) => [name]),
      rowsOmitted: 2,
      canAddRows: true,
      canEditCells: true,
      pending: { edits: 1, deletions: 0 },
      visible: true
    });
    expect(hub).toEqual({
      id: 'tbl-hub',
      hubId: 'hub-resolved',
      columns: [{ name: 'Name', fieldKey: 'name', readOnly: true }],
      rowCount: 185,
      canEditCells: true,
      visible: true
    });
  });
});
