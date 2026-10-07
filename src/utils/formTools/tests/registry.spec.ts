import internalState from '../../internalState';
import { isInteractionDetected } from '../../interactionState';
import { getFormTools } from '../registry';

const FORM = 'registry-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

const field = {
  id: 'name-el',
  position: [],
  properties: {},
  servar: { id: 'name-sv', key: 'name', type: 'text_field', metadata: {} }
};

const seed = () => {
  const currentStep = {
    id: 'step-1',
    key: 'intro',
    servar_fields: [field],
    ...emptyStepArrays
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { intro: currentStep },
    fields: {},
    visiblePositions: {},
    inlineErrors: {},
    logicRules: [],
    formToolsRenderTick: 0,
    formToolsCallbacks: {
      changeValue: jest.fn((value: any, f: any) => {
        (internalState as any)[FORM].fields[f.servar.key] = { value };
      }),
      fieldOnChange: jest.fn(() => jest.fn()),
      getNextStepKey: jest.fn(() => undefined),
      buttonOnClick: jest.fn(async () => undefined),
      // Simulates <Form/>'s useLayoutEffect bumping this once per commit;
      // without it, fillStep.ts's waitForNextCommit would poll forever here,
      // since no real <Form/> is mounted in this test.
      awaitChangeRules: jest.fn(async () => {
        (internalState as any)[FORM].formToolsRenderTick += 1;
      })
    }
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('getFormTools', () => {
  it('exposes exactly feathery_get_step, feathery_fill_step and feathery_next_step with their annotations', () => {
    seed();
    const tools = getFormTools(FORM);

    expect(tools.map((t) => t.name)).toEqual([
      'feathery_get_step',
      'feathery_fill_step',
      'feathery_next_step'
    ]);
    const getStep = tools.find((t) => t.name === 'feathery_get_step')!;
    expect(getStep.annotations).toMatchObject({
      readOnlyHint: true,
      untrustedContentHint: true
    });
    const nextStep = tools.find((t) => t.name === 'feathery_next_step')!;
    expect(nextStep.annotations).toEqual({ consequentialHint: true });
    expect(nextStep.inputSchema).toEqual({
      type: 'object',
      properties: {
        buttonId: {
          type: 'string',
          description:
            "id of the button to press; omit to use the step's own save-and-advance button."
        }
      },
      additionalProperties: false
    });
  });

  it('never opens the interaction gate for the read-only feathery_get_step', async () => {
    seed();
    const windowDispatchSpy = jest
      .spyOn(window, 'dispatchEvent')
      .mockImplementation(() => true);

    const tools = getFormTools(FORM);
    await tools.find((t) => t.name === 'feathery_get_step')!.execute({});

    expect(windowDispatchSpy).not.toHaveBeenCalled();
    windowDispatchSpy.mockRestore();
  });

  it('opens the interaction gate once, on the first execute of feathery_fill_step', async () => {
    seed();
    // mockImplementation stops the event from reaching the real defaultClient
    // listener (registered on module load), which would try to flush fields
    // over the network and throw for lack of an SDK key in this unit test.
    const windowDispatchSpy = jest
      .spyOn(window, 'dispatchEvent')
      .mockImplementation(() => true);
    const wasAlreadyOpen = isInteractionDetected();

    const tools = getFormTools(FORM);
    await tools
      .find((t) => t.name === 'feathery_fill_step')!
      .execute({
        values: {}
      });

    if (!wasAlreadyOpen) {
      expect(windowDispatchSpy).toHaveBeenCalledTimes(1);
    } else {
      expect(windowDispatchSpy).not.toHaveBeenCalled();
    }
    expect(isInteractionDetected()).toBe(true);
    windowDispatchSpy.mockRestore();
  });

  it('feathery_get_step and feathery_fill_step round-trip through the real tool implementations', async () => {
    seed();
    const tools = getFormTools(FORM);

    const step = await tools
      .find((t) => t.name === 'feathery_get_step')!
      .execute({});
    expect(step.fields.map((f: any) => f.key)).toEqual(['name']);

    const fillResult = await tools
      .find((t) => t.name === 'feathery_fill_step')!
      .execute({ values: { name: 'Ada' } });
    expect(fillResult.fields.name).toEqual({ status: 'filled', value: 'Ada' });
  });
});
