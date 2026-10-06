import internalState from '../../internalState';
import { navigateToStep } from '../navigateToStep';

// A submit error published late still comes back in fieldErrors
describe('navigateToStep inline error reporting', () => {
  const formUuid = 'form-navigate-test';

  // Publishes on a timer like the form's own button errors do
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
      formActions: {
        runElementActions: jest.fn(async () => onNavigate(state))
      }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('awaits the async error publication before diffing', async () => {
    makeState((state) => {
      publishLater(state, {
        name: { byIndex: { 1: { message: 'Required' } } }
      });
    });

    const result: any = await navigateToStep(formUuid, 'step-2');

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toEqual([
      { key: 'name', repeatIndex: 1, message: 'Required' }
    ]);
  });

  it('reports no field errors when nothing was published', async () => {
    makeState(() => {});

    const result: any = await navigateToStep(formUuid, 'step-2');

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toBeUndefined();
  });
});
