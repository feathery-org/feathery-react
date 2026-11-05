import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';
import { fieldValues } from '../init';

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

it('labels choice options with what the person sees, falling back to the value', () => {
  const currentStep = {
    id: 'step-1',
    key: 'billing',
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
        servar: {
          id: 'field-1',
          key: 'frequency',
          type: 'dropdown',
          metadata: {
            options: ['opt_1', 'opt_2'],
            option_labels: ['Monthly', '']
          }
        },
        properties: {},
        position: []
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { billing: currentStep },
    fields: { frequency: { value: '' } },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM)!;

  expect(snapshot.currentStepFields[0].options).toEqual([
    { value: 'opt_1', label: 'Monthly' },
    { value: 'opt_2', label: 'opt_2' }
  ]);
});

it('shows what a matrix lets the person answer', () => {
  const currentStep = {
    id: 'step-1',
    key: 'survey',
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
        servar: {
          id: 'field-1',
          key: 'csat',
          type: 'matrix',
          metadata: {
            multiple: false,
            options: ['Good', 'Bad'],
            questions: [
              { id: 'q1', label: 'Service' },
              { id: 'q2', label: 'Price', read_only: true }
            ]
          }
        },
        properties: {},
        position: []
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { survey: currentStep },
    fields: { csat: { value: {} } },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM);

  expect(snapshot?.currentStepFields[0]).toMatchObject({
    multiple: false,
    options: [
      { value: 'Good', label: 'Good' },
      { value: 'Bad', label: 'Bad' }
    ],
    questions: [
      { id: 'q1', label: 'Service' },
      { id: 'q2', label: 'Price', readOnly: true }
    ]
  });
});

it("carries each item's layout position so a host can list the step in page order", () => {
  const currentStep = {
    id: 'step-1',
    key: 'intro',
    subgrids: [],
    texts: [
      { id: 'heading', properties: { text: 'About you' }, position: [0] }
    ],
    images: [],
    buttons: [{ id: 'next', properties: { text: 'Next' }, position: [2] }],
    tables: [],
    tabs: [],
    progress_bars: [],
    next_conditions: [],
    servar_fields: [
      {
        servar: { id: 'field-1', key: 'first_name', type: 'text_field' },
        properties: {},
        position: [1, 0]
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { intro: currentStep },
    fields: { first_name: { value: '' } },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM)!;

  expect(snapshot.currentStepFields[0].position).toEqual([1, 0]);
  expect(
    snapshot.currentStepElements.map((element) => element.position)
  ).toEqual(expect.arrayContaining([[0], [2]]));
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
      showsGrid: false,
      ...over
    }),
    getRows: ({ limit }: { limit: number }) => {
      const shown = names
        .map((name, rowIndex) => ({ rowIndex, values: { name_key: name } }))
        .filter((row) => row.rowIndex !== 1);
      return { rowCount: shown.length, rows: shown.slice(0, limit) };
    }
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
      rows: names.slice(0, 10).map((name, rowIndex) => ({
        rowIndex,
        values: { name_key: name, age_key: rowIndex < 2 ? rowIndex + 1 : null }
      })),
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

  it('masks a sensitive selected cell and its row for an agent read', () => {
    const selection = {
      rowIndex: 0,
      fieldKey: 'name_key',
      columnName: 'Name',
      value: '123456789',
      row: { name_key: '123456789' }
    };
    (internalState as any)[FORM] = {
      currentStep: stepWithTables([fieldTable]),
      steps: {
        intro: { servar_fields: [{ servar: { key: 'name_key', type: 'ssn' } }] }
      },
      fields: {},
      visiblePositions: {},
      inlineErrors: {},
      logicRules: [],
      tables: new Map<string, any>([
        ['tbl-field', mountedHandlers({ rowCount: 1, selection })]
      ])
    };

    const raw = getPanelRuntimeSnapshot(FORM)?.currentStepTables[0];
    const masked = getPanelRuntimeSnapshot(FORM, { masked: true })
      ?.currentStepTables[0];

    expect(raw?.selection).toEqual(selection);
    expect(masked?.selection).toMatchObject({
      value: '••••6789',
      row: { name_key: '••••6789' }
    });
  });

  it('takes a mounted table from its grid by source row index, with hub rows left out and the resolved hub named', () => {
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
            pending: { edits: 1, deletions: 1 }
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
      rows: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rowIndex) => ({
        rowIndex,
        values: { name_key: names[rowIndex] }
      })),
      rowsOmitted: 1,
      canAddRows: true,
      canEditCells: true,
      pending: { edits: 1, deletions: 1 },
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

  it('carries what the person has in front of them in a rendered spreadsheet', () => {
    const selection = {
      rowIndex: 3,
      entryId: 'entry-3',
      fieldKey: 'name',
      columnName: 'Name',
      value: 'Person 3',
      error: 'Must be a number',
      row: { name: 'Person 3' }
    };
    (internalState as any)[FORM] = {
      currentStep: stepWithTables([hubTable]),
      fields: {},
      visiblePositions: {},
      inlineErrors: {},
      logicRules: [],
      tables: new Map<string, any>([
        [
          'tbl-hub',
          mountedHandlers({
            hubId: 'hub-resolved',
            columns: [{ name: 'Name', fieldKey: 'name' }],
            rowCount: 185,
            showsGrid: true,
            selection,
            viewport: { visibleRowIndexes: [2, 3, 4] },
            ruleErrors: { total: 7 },
            findings: 2
          })
        ]
      ])
    };

    const [hub] = getPanelRuntimeSnapshot(FORM)!.currentStepTables;

    expect(hub).toEqual({
      id: 'tbl-hub',
      hubId: 'hub-resolved',
      columns: [{ name: 'Name', fieldKey: 'name' }],
      rowCount: 185,
      selection,
      viewport: { visibleRowIndexes: [2, 3, 4] },
      ruleErrors: { total: 7 },
      findings: 2,
      visible: true
    });
  });
});

describe('unique repeat options in the snapshot', () => {
  const setUp = (metadata: Record<string, unknown>) => {
    const currentStep = {
      id: 'step-1',
      key: 'plans',
      subgrids: [{ id: 'sg', position: [0], repeated: true }],
      texts: [],
      images: [],
      buttons: [],
      tables: [],
      tabs: [],
      progress_bars: [],
      next_conditions: [],
      servar_fields: [
        {
          servar: {
            id: 'field-1',
            key: 'plan',
            type: 'dropdown',
            repeated: true,
            metadata: {
              options: ['basic', 'pro'],
              option_labels: ['Basic', 'Pro'],
              ...metadata
            }
          },
          properties: {},
          position: [0, 0]
        }
      ]
    };
    (internalState as any)[FORM] = {
      currentStep,
      steps: { plans: currentStep },
      fields: { plan: { value: ['pro', ''] } },
      visiblePositions: { '0': [true, true], '0,0': [true, true] },
      inlineErrors: {},
      logicRules: []
    };
    const snapshot = getPanelRuntimeSnapshot(FORM);
    if (!snapshot) throw new Error('The form did not load');
    return snapshot.currentStepFields[0];
  };

  it("leaves other rows' picks out of each row's options", () => {
    const field = setUp({ unique_repeat_options: true });

    expect(field.rowOptions).toEqual([
      null,
      [{ value: 'basic', label: 'Basic' }]
    ]);
  });

  it('lists the full options for every row when picks may repeat', () => {
    const field = setUp({});

    expect(field.rowOptions).toBeUndefined();
    expect(field.options).toEqual([
      { value: 'basic', label: 'Basic' },
      { value: 'pro', label: 'Pro' }
    ]);
  });
});

it('masks sensitive values on every step for the agent, leaving the runtime read raw', () => {
  const step = (key: string, servars: any[]) => ({
    id: key,
    key,
    subgrids: [],
    texts: [],
    images: [],
    buttons: [],
    tables: [],
    tabs: [],
    progress_bars: [],
    next_conditions: [],
    servar_fields: servars.map((servar) => ({
      servar,
      properties: {},
      position: []
    }))
  });
  const identity = step('identity', [{ id: 'f-ssn', key: 'ssn', type: 'ssn' }]);
  const account = {
    ...step('account', [
      { id: 'f-pw', key: 'pw', type: 'password' },
      { id: 'f-pin', key: 'pins', type: 'pin_input', repeated: true },
      { id: 'f-name', key: 'name', type: 'text_field' }
    ]),
    tables: [
      {
        id: 'tbl',
        position: [0],
        properties: { columns: [{ name: 'PIN', field_key: 'pins' }] }
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep: account,
    steps: { identity, account },
    fields: {
      ssn: { value: '123456789' },
      pw: { value: 'hunter22' },
      pins: { value: ['4242', null] },
      name: { value: 'Ada' }
    },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const raw = getPanelRuntimeSnapshot(FORM);
  const snapshot = getPanelRuntimeSnapshot(FORM, { masked: true });

  expect(raw?.values.ssn).toBe('123456789');

  expect(snapshot?.values).toEqual({
    ssn: '••••6789',
    pw: '••••',
    pins: ['••••', null],
    name: 'Ada'
  });
  expect(
    Object.fromEntries(
      (snapshot?.currentStepFields ?? []).map((f) => [f.key, f.value])
    )
  ).toEqual({ pw: '••••', pins: ['••••', null], name: 'Ada' });
  expect(snapshot?.currentStepTables[0].rows).toEqual([
    { rowIndex: 0, values: { pins: '••••' } },
    { rowIndex: 1, values: { pins: null } }
  ]);
});

it('masks sensitive values interpolated into text for an agent read', () => {
  const currentStep = {
    id: 'step-1',
    key: 'confirm',
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
        servar: { id: 'f-ssn', key: 'ssn', type: 'ssn' },
        properties: { placeholder: 'SSN on file: {{ssn}}' },
        position: []
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { confirm: currentStep },
    fields: { ssn: { value: '123456789' } },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };
  fieldValues.ssn = '123456789';

  try {
    expect(
      getPanelRuntimeSnapshot(FORM)?.currentStepFields[0].placeholder
    ).toBe('SSN on file: 123456789');
    expect(
      getPanelRuntimeSnapshot(FORM, { masked: true })?.currentStepFields[0]
        .placeholder
    ).toBe('SSN on file: ••••6789');
  } finally {
    delete fieldValues.ssn;
  }
});
