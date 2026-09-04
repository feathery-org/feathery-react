import internalState from '../../../utils/internalState';
import { dispatchTriggerTableAction } from '../triggerTableAction';

// dispatchTriggerTableAction must await the producer's pending async error
// publication before snapshotting, so a submit error published on a timer is
// reported in fieldErrors instead of silently missed.
describe('dispatchTriggerTableAction inline error reporting', () => {
  const formUuid = 'form-table-test';

  // Mirrors production setButtonError: the write lands on a timer, and the
  // pending publication is exposed on internalState for callers to await.
  const publishLater = (state: any, inlineErrors: any, delayMs = 10) => {
    state.pendingInlineErrorPublish = new Promise<void>((resolve) => {
      setTimeout(() => {
        state.inlineErrors = inlineErrors;
        state.pendingInlineErrorPublish = undefined;
        resolve();
      }, delayMs);
    });
  };

  const makeState = (onAction: (state: any) => void) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        tables: [
          {
            id: 'tbl',
            position: [0],
            properties: {
              columns: [{ field_key: 'col1', name: 'Col 1' }],
              actions: [{ label: 'Go' }]
            }
          }
        ]
      },
      visiblePositions: { '0': [true] },
      fields: { col1: { value: ['a', 'b'] } },
      formSettings: {},
      inlineErrors: {},
      assistantClient: {
        runTableAction: jest.fn(async () => onAction(state))
      }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('awaits the async error publication before diffing', async () => {
    // The error does NOT exist when runTableAction resolves -- only after the
    // timer. A dropped await here would report no fieldErrors.
    makeState((state) => {
      publishLater(state, {
        name: { byIndex: { 0: { message: 'Required' } } }
      });
    });

    const result: any = await dispatchTriggerTableAction(
      formUuid,
      'tbl',
      1,
      'Go'
    );

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toEqual([
      { key: 'name', repeatIndex: 0, message: 'Required' }
    ]);
  });

  it('reports no field errors when nothing was published', async () => {
    makeState(() => {});

    const result: any = await dispatchTriggerTableAction(
      formUuid,
      'tbl',
      0,
      'Go'
    );

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toBeUndefined();
  });
});
