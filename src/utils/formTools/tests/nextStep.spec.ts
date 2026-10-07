import internalState from '../../internalState';
import { _clearUnsavedWorkRegistry, setUnsavedWork } from '../../unsavedWork';
import { nextStepTool } from '../nextStep';
import { getStepTool } from '../getStep';

const FORM = 'next-step-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  tables: [],
  tabs: [],
  progress_bars: []
};

const nextButton = (
  id: string,
  overrides: Record<string, any> = {},
  position: number[] = [0]
) => ({
  id,
  position,
  properties: { submit: true, actions: [{ type: 'next' }], ...overrides }
});

let buttonOnClickMock: jest.Mock;
let getNextStepKeyMock: jest.Mock;

const seed = (
  buttons: any[],
  opts: { visiblePositions?: any; submitQueue?: Promise<any> } = {}
) => {
  const currentStep = {
    id: 'step-1',
    key: 'step-1',
    servar_fields: [],
    buttons,
    next_conditions: [],
    ...emptyStepArrays
  };
  // A reachable, non-terminal step 2 by default; tests that need otherwise override it
  const nextStep = {
    id: 'step-2',
    key: 'step-2',
    servar_fields: [],
    buttons: [],
    next_conditions: [{ to_step: 'step-3' }],
    ...emptyStepArrays
  };
  buttonOnClickMock = jest.fn(async () => undefined);
  getNextStepKeyMock = jest.fn(() => 'step-2');

  (internalState as any)[FORM] = {
    currentStep,
    steps: { 'step-1': currentStep, 'step-2': nextStep },
    fields: {},
    visiblePositions: opts.visiblePositions ?? { '0': [true] },
    inlineErrors: {},
    logicRules: [],
    formSettings: {},
    formToolsRenderTick: 0,
    client: { submitQueue: opts.submitQueue ?? Promise.resolve() },
    formToolsCallbacks: {
      changeValue: jest.fn(),
      fieldOnChange: jest.fn(),
      getNextStepKey: getNextStepKeyMock,
      buttonOnClick: buttonOnClickMock,
      awaitChangeRules: jest.fn(async () => undefined)
    }
  };
  return currentStep;
};

// Simulates <Form/>'s useLayoutEffect (bumped once per real commit) plus the
// currentStep/latestStepName write a real navigation makes together -
// without it, waitForNextCommit (nextStep.ts) would poll forever here, since
// nothing in these tests ever mounts a real <Form/>.
const advanceToStep2 = () => {
  const state = (internalState as any)[FORM];
  state.currentStep = state.steps['step-2'];
  state.latestStepName = 'step-2';
  state.formToolsRenderTick = (state.formToolsRenderTick ?? 0) + 1;
};

afterEach(() => {
  delete (internalState as any)[FORM];
  _clearUnsavedWorkRegistry();
  jest.clearAllMocks();
});

describe('nextStepTool', () => {
  it("advances via the step's own submit+next button", async () => {
    seed([nextButton('btn-1')]);
    buttonOnClickMock.mockImplementation(async () => advanceToStep2());

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'advanced',
      fromStep: 'step-1',
      toStep: 'step-2',
      saved: true,
      snapshot: getStepTool(FORM)
    });
    expect(result.snapshot.step).toEqual({ id: 'step-2', key: 'step-2' });
    expect(buttonOnClickMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'btn-1' })
    );
  });

  it('reports saved: false when the step save the click started fails', async () => {
    const failedSave = Promise.reject(new Error('deadlock detected'));
    failedSave.catch(() => undefined);
    seed([nextButton('btn-1')], { submitQueue: failedSave });
    buttonOnClickMock.mockImplementation(async () => advanceToStep2());

    const result = await nextStepTool(FORM, {});

    expect(result).toMatchObject({ status: 'advanced', saved: false });
  });

  it('presses a Next button that only navigates and reports it saved nothing', async () => {
    seed([nextButton('btn-1', { submit: false })]);
    buttonOnClickMock.mockImplementation(async () => advanceToStep2());

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'advanced',
      fromStep: 'step-1',
      toStep: 'step-2',
      saved: false,
      snapshot: getStepTool(FORM)
    });
  });

  it('prefers the Next button that saves the step', async () => {
    seed([
      nextButton('navigate-only', { submit: false }, [0]),
      nextButton('save-and-next', {}, [1])
    ]);
    (internalState as any)[FORM].visiblePositions = {
      '0': [true],
      '1': [true]
    };
    buttonOnClickMock.mockImplementation(async () => advanceToStep2());

    await nextStepTool(FORM, {});

    expect(buttonOnClickMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'save-and-next' })
    );
  });

  it('refuses when the resolved next step is terminal', async () => {
    const terminalStep = {
      id: 'step-2',
      key: 'step-2',
      servar_fields: [],
      buttons: [],
      next_conditions: [],
      ...emptyStepArrays
    };
    seed([nextButton('btn-1')]);
    (internalState as any)[FORM].steps['step-2'] = terminalStep;
    getNextStepKeyMock.mockReturnValue('step-2');

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'refused',
      fromStep: 'step-1',
      reason: 'Advancing would complete the form.'
    });
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses when the button has no next step, since that click completes the form', async () => {
    seed([nextButton('submit-btn')]);
    getNextStepKeyMock.mockReturnValue(undefined);

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'refused',
      fromStep: 'step-1',
      reason: 'Advancing would complete the form.'
    });
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses on a button requiring CAPTCHA verification', async () => {
    seed([nextButton('btn-1', { captcha_verification: true })]);

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/CAPTCHA/);
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses on a button whose actions include an outside-flow type', async () => {
    seed([
      nextButton('btn-1', {
        actions: [{ type: 'next' }, { type: 'trigger_plaid' }]
      })
    ]);

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/trigger_plaid/);
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses when the form has unsaved work', async () => {
    seed([nextButton('btn-1')]);
    setUnsavedWork(FORM, 'table:t1', 'Table has unsaved changes.');

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/unsaved work/);
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses when the form is read-only', async () => {
    seed([nextButton('btn-1')]);
    (internalState as any)[FORM].formSettings = { readOnly: true };

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('refused');
    expect(result.reason).toBe('This form is read-only.');
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('returns errors when the click leaves a new inline error and no navigation', async () => {
    seed([nextButton('btn-1')]);
    buttonOnClickMock.mockImplementation(async () => {
      (internalState as any)[FORM].inlineErrors = {
        promo_code: { message: 'Invalid code' }
      };
    });

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'errors',
      fromStep: 'step-1',
      errors: { promo_code: 'Invalid code' }
    });
  });

  it('returns no_change when the click produces neither navigation nor errors', async () => {
    seed([nextButton('btn-1')]);

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('no_change');
    expect(result.fromStep).toBe('step-1');
  });

  it('refuses with a reason when the given buttonId is not a qualifying button', async () => {
    seed([nextButton('btn-1')]);

    const result = await nextStepTool(FORM, { buttonId: 'does-not-exist' });

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/does-not-exist/);
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('refuses a disabled button', async () => {
    seed([nextButton('btn-1', { disable_if_fields_incomplete: true })]);
    const step = (internalState as any)[FORM].currentStep;
    step.servar_fields = [
      {
        id: 'el-name',
        position: [1],
        properties: {},
        servar: {
          id: 'sv-name',
          key: 'name',
          type: 'text_field',
          required: true,
          metadata: {}
        }
      }
    ];
    (internalState as any)[FORM].visiblePositions = {
      '0': [true],
      '1': [true]
    };

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('refused');
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });

  it('skips a hidden button rather than pressing it', async () => {
    seed([nextButton('btn-1')], { visiblePositions: { '0': [false] } });

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'refused',
      fromStep: 'step-1',
      reason: 'No visible button on this step advances the form.'
    });
    expect(buttonOnClickMock).not.toHaveBeenCalled();
  });
});
