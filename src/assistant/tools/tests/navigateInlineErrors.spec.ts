import internalState from '../../../utils/internalState';
import { dispatchNavigate } from '../navigate';

// dispatchNavigate must await the producer's pending async error publication
// before snapshotting, so a submit error published on a timer is reported in
// fieldErrors instead of silently missed.
describe('dispatchNavigate inline error reporting', () => {
  const formUuid = 'form-navigate-test';

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

  const makeState = (onNavigate: (state: any) => void) => {
    const state: any = {
      currentStep: {
        key: 'step-1',
        progress_bars: [],
        tabs: [
          {
            position: [0],
            properties: { entries: [{ step_key: 'step-2' }] }
          }
        ]
      },
      visiblePositions: { '0': [true] },
      formSettings: {},
      inlineErrors: {},
      assistantClient: { runActions: jest.fn(async () => onNavigate(state)) }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('awaits the async error publication before diffing', async () => {
    // The error does NOT exist when runActions resolves -- only after the
    // timer. A dropped await here would report no fieldErrors.
    makeState((state) => {
      publishLater(state, {
        name: { byIndex: { 1: { message: 'Required' } } }
      });
    });

    const result: any = await dispatchNavigate(formUuid, 'step-2');

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toEqual([
      { key: 'name', repeatIndex: 1, message: 'Required' }
    ]);
  });

  it('reports no field errors when nothing was published', async () => {
    makeState(() => {});

    const result: any = await dispatchNavigate(formUuid, 'step-2');

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toBeUndefined();
  });
});
