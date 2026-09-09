import internalState from '../../../utils/internalState';
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

const buildState = (assistantClient?: any) => {
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
    assistantClient
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('hub table column parity', () => {
  it('describes the columns the mounted grid renders, not the ones stored on the element', () => {
    buildState({
      getTableLiveState: () => undefined,
      getTableColumns: () => [
        { name: 'Status', hub_field_key: 'status' },
        { name: 'Email', hub_field_key: 'email' },
        { name: 'Advisor', hub_field_key: 'advisor' }
      ]
    });

    const table = getPanelRuntimeSnapshot(FORM)!.currentStepTables![0];

    expect(table.columns).toEqual([
      { name: 'Status', fieldKey: 'status' },
      { name: 'Email', fieldKey: 'email' },
      { name: 'Advisor', fieldKey: 'advisor' }
    ]);
  });

  it('falls back to the stored columns while the table is not mounted', () => {
    buildState({
      getTableLiveState: () => undefined,
      getTableColumns: () => null
    });

    const table = getPanelRuntimeSnapshot(FORM)!.currentStepTables![0];

    expect(table.columns).toEqual([{ name: 'Email', fieldKey: 'email' }]);
  });
});
