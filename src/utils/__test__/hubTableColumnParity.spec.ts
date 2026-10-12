import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';

const FORM = 'hub-table-parity-form';
const TABLE_ID = 'table-1';

const hubTable = {
  id: TABLE_ID,
  properties: {
    data_source: 'hub',
    hub_id: 'hub-1',
    columns: [{ name: 'Email', hub_field_key: 'email' }]
  },
  position: []
};

const buildState = (
  liveColumns?: Array<{ name: string; fieldKey: string }>
) => {
  const currentStep = {
    id: 'step-1',
    key: 'intro',
    subgrids: [],
    texts: [],
    images: [],
    buttons: [],
    tables: [hubTable],
    tabs: [],
    progress_bars: [],
    next_conditions: [],
    servar_fields: []
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { intro: currentStep },
    fields: {},
    visiblePositions: {},
    inlineErrors: {},
    logicRules: [],
    ...(liveColumns
      ? {
          tables: new Map([
            [
              TABLE_ID,
              {
                getLiveState: () => ({ columns: liveColumns, rowCount: 0 }),
                getRows: () => ({ rowCount: 0, rows: [] })
              }
            ]
          ])
        }
      : {})
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('hub table column parity', () => {
  it('describes the columns the mounted grid renders, not the ones stored on the element', () => {
    buildState([
      { name: 'Status', fieldKey: 'status' },
      { name: 'Email', fieldKey: 'email' },
      { name: 'Advisor', fieldKey: 'advisor' }
    ]);

    const table = getPanelRuntimeSnapshot(FORM)!.currentStepTables![0];

    expect(table.columns).toEqual([
      { name: 'Status', fieldKey: 'status' },
      { name: 'Email', fieldKey: 'email' },
      { name: 'Advisor', fieldKey: 'advisor' }
    ]);
  });

  it('falls back to the stored columns while the table is not mounted', () => {
    buildState();

    const table = getPanelRuntimeSnapshot(FORM)!.currentStepTables![0];

    expect(table.columns).toEqual([{ name: 'Email', fieldKey: 'email' }]);
  });
});
