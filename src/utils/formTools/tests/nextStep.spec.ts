import internalState from '../../internalState';
import { fieldValues, initState } from '../../init';
import { nextStepTool } from '../nextStep';
import { getStepTool } from '../getStep';
import { emptyStepArrays, seedForm } from './helpers';

const FORM = 'next-step-form';

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

const seed = (buttons: any[], opts: { visiblePositions?: any } = {}) => {
  // A reachable, non-terminal step 2 by default; tests that need otherwise override it
  const nextStep = {
    id: 'step-2',
    key: 'step-2',
    servar_fields: [],
    buttons: [],
    ...emptyStepArrays,
    next_conditions: [{ to_step: 'step-3' }]
  };
  buttonOnClickMock = jest.fn(async () => undefined);
  const { currentStep, getNextStepKey } = seedForm(FORM, {
    step: { buttons },
    steps: { 'step-2': nextStep },
    nextStepKey: 'step-2',
    visiblePositions: opts.visiblePositions ?? { '0': [true] },
    callbacks: { buttonOnClick: buttonOnClickMock },
    state: {
      formSettings: {},
      // The "previous" save already in flight when the click happens; a test
      // that wants this click to start a real save sets a new reference inside
      // its buttonOnClickMock implementation (mirroring Form/index.tsx's
      // submitStep writing it where client.submitStep is called).
      formToolsLastSave: Promise.resolve()
    }
  });
  getNextStepKeyMock = getNextStepKey;
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
  jest.clearAllMocks();
});

describe('nextStepTool', () => {
  it("advances via the step's own submit+next button", async () => {
    seed([nextButton('btn-1')]);
    buttonOnClickMock.mockImplementation(async () => {
      // Mirrors Form/index.tsx's submitStep writing a fresh promise where it
      // calls client.submitStep for this click.
      (internalState as any)[FORM].formToolsLastSave = Promise.resolve();
      advanceToStep2();
    });

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

  it('follows a load rule that moves the form on from the new step', async () => {
    seed([nextButton('btn-1')]);
    const state = (internalState as any)[FORM];
    state.steps['step-3'] = {
      ...state.steps['step-2'],
      id: 'step-3',
      key: 'step-3'
    };
    buttonOnClickMock.mockImplementation(async () => {
      state.latestStepName = 'step-2';
      // step-2's load rule navigates on before step-2 ever renders
      setTimeout(() => {
        state.currentStep = state.steps['step-3'];
        state.latestStepName = 'step-3';
        state.formToolsRenderTick += 1;
      }, 0);
    });

    const result = await nextStepTool(FORM, {});

    expect(result).toMatchObject({ status: 'advanced', toStep: 'step-3' });
  });

  it('reports saved: false when the step save the click started fails', async () => {
    const failedSave = Promise.reject(new Error('deadlock detected'));
    failedSave.catch(() => undefined);
    seed([nextButton('btn-1')]);
    buttonOnClickMock.mockImplementation(async () => {
      (internalState as any)[FORM].formToolsLastSave = failedSave;
      advanceToStep2();
    });

    const result = await nextStepTool(FORM, {});

    expect(result).toMatchObject({ status: 'advanced', saved: false });
  });

  it('reports saved: false when the click starts no new save, even on a submit button', async () => {
    seed([nextButton('btn-1')]);
    // advanceToStep2() alone never touches formToolsLastSave - the click
    // navigated without actually kicking off a fresh submitStep this time.
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

  it("checks the action's own target step before the step's navigation", async () => {
    const terminalStep = {
      id: 'step-9',
      key: 'step-9',
      servar_fields: [],
      buttons: [],
      next_conditions: [],
      ...emptyStepArrays
    };
    seed([
      nextButton('btn-1', {
        actions: [{ type: 'next', next_step_key: 'step-9' }]
      })
    ]);
    (internalState as any)[FORM].steps['step-9'] = terminalStep;

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

  it('presses a Next button regardless of its other actions', async () => {
    seed([
      nextButton('btn-1', {
        actions: [{ type: 'next' }, { type: 'trigger_plaid' }]
      })
    ]);
    buttonOnClickMock.mockImplementation(async () => advanceToStep2());

    const result = await nextStepTool(FORM, {});

    expect(result.status).toBe('advanced');
    expect(buttonOnClickMock).toHaveBeenCalled();
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

  it("returns the form's own validation errors when an html5 form blocks the click", async () => {
    const step = seed([nextButton('btn-1', {}, [1])], {
      visiblePositions: { '0': [true], '1': [true] }
    });
    step.servar_fields = [
      {
        id: 'el-email',
        position: [0],
        properties: {},
        servar: {
          key: 'contact_email',
          type: 'text_field',
          required: true,
          repeated: false,
          metadata: {}
        }
      }
    ] as any;
    fieldValues.contact_email = '';
    initState.sdkKey = 'sdk-key';
    initState.defaultErrors = { required: 'This is a required field.' };

    const result = await nextStepTool(FORM, {});

    expect(result).toEqual({
      status: 'errors',
      fromStep: 'step-1',
      errors: { contact_email: 'This is a required field.' }
    });
    delete fieldValues.contact_email;
    initState.sdkKey = '';
    initState.defaultErrors = {};
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

  // Blocker 5: the driver's own next call (or final callback) must never be
  // able to reach the backend before this click's STEP_EVENT_COMPLETE
  // request does, so the result this click returns must not resolve while
  // that request - carried on the form's client.eventQueue - is still
  // pending.
  it("does not resolve until the click's eventQueue request settles", async () => {
    seed([nextButton('btn-1')]);
    let resolveEvent: (() => void) | undefined;
    const pendingEvent = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    buttonOnClickMock.mockImplementation(async () => {
      // Mirrors registerEvent chaining a new request onto eventQueue.
      (internalState as any)[FORM].client.eventQueue = pendingEvent;
      advanceToStep2();
    });

    let resolved = false;
    const resultPromise = nextStepTool(FORM, {}).then((result) => {
      resolved = true;
      return result;
    });

    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(resolved).toBe(false);
    expect(buttonOnClickMock).toHaveBeenCalled();

    resolveEvent?.();
    const result = await resultPromise;

    expect(resolved).toBe(true);
    expect(result.status).toBe('advanced');
  });
});
