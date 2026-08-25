import internalState from '../../../utils/internalState';
import { dispatchClickElement } from '../clickElement';

// The click result must report a repeated button's OWN error as buttonError
// (keyed to the clicked row) rather than leaking it into fieldErrors -- and it
// must do so even though production publishes that error asynchronously.
describe('dispatchClickElement repeated button error contract', () => {
  const formUuid = 'form-click-test';

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

  const makeState = (onClick: (state: any) => void) => {
    const state: any = {
      currentStep: {
        buttons: [{ id: 'btn', position: [0, 1], properties: {} }],
        texts: [],
        subgrids: [{ id: 'sg', position: [0], repeated: true }],
        servar_fields: []
      },
      visiblePositions: { '0': [true, true], '0,1': [true, true] },
      formSettings: {},
      inlineErrors: {},
      assistantClient: { click: jest.fn(async () => onClick(state)) }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
    jest.useRealTimers();
  });

  it("awaits the async publication and returns the clicked row's error as buttonError", async () => {
    // The error does NOT exist when click() resolves -- only after the timer.
    makeState((state) => {
      publishLater(state, { btn: { byIndex: { 1: { message: 'Required' } } } });
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
    expect(result.buttonError).toBe('Required');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('still settles when the publication is slower', async () => {
    makeState((state) => {
      publishLater(state, { btn: { byIndex: { 0: { message: 'Slow' } } } }, 50);
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 0);

    expect(result.buttonError).toBe('Slow');
  });

  it("does not treat another row's error as the clicked button's error", async () => {
    makeState((state) => {
      publishLater(state, { btn: { byIndex: { 0: { message: 'Other row' } } } });
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
    // Row 0 isn't the clicked row (1): reported as a field error, not buttonError.
    expect(result.buttonError).toBeUndefined();
    expect(result.fieldErrors).toEqual([
      { key: 'btn', repeatIndex: 0, message: 'Other row' }
    ]);
  });

  it('reports a servar error separately from the button error', async () => {
    makeState((state) => {
      publishLater(state, {
        btn: { byIndex: { 1: { message: 'Fix the row' } } },
        name: { byIndex: { 1: { message: 'Required' } } }
      });
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 1);

    expect(result.buttonError).toBe('Fix the row');
    expect(result.fieldErrors).toEqual([
      { key: 'name', repeatIndex: 1, message: 'Required' }
    ]);
  });
});
