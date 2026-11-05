import internalState from '../../internalState';
import { getFormTools } from '../registry';
import { seedForm } from './helpers';

const FORM = 'registry-form';

const field = {
  id: 'name-el',
  position: [],
  properties: {},
  servar: { id: 'name-sv', key: 'name', type: 'text_field', metadata: {} }
};

// `state` defaults to the shared internalState module, but takes an
// isolated one too - see the interaction-gate test below, which needs its
// own module graph rather than this file's top-level imports.
const seed = (state: any = internalState) => {
  seedForm(FORM, {
    internalState: state,
    stepId: 'step-1',
    stepKey: 'intro',
    fields: [field],
    callbacks: { buttonOnClick: jest.fn(async () => undefined) }
  });
};

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('getFormTools', () => {
  it('describes feathery_next_step input as an optional buttonId', () => {
    seed();
    const nextStep = getFormTools(FORM).find(
      (t) => t.name === 'feathery_next_step'
    )!;

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
    // interactionDetected is shared module state with no reset export, so
    // this pins "opens once" against a fresh module graph rather than
    // branching on whatever another test in this file left it as.
    let freshInternalState: any;
    let freshIsInteractionDetected: () => boolean;
    let freshGetFormTools: (formUuid: string) => any;
    jest.isolateModules(() => {
      freshInternalState = require('../../internalState').default;
      freshIsInteractionDetected =
        require('../../interactionState').isInteractionDetected;
      freshGetFormTools = require('../registry').getFormTools;
    });
    seed(freshInternalState);
    expect(freshIsInteractionDetected()).toBe(false);

    // mockImplementation stops the event from reaching the real defaultClient
    // listener (registered on module load), which would try to flush fields
    // over the network and throw for lack of an SDK key in this unit test.
    const windowDispatchSpy = jest
      .spyOn(window, 'dispatchEvent')
      .mockImplementation(() => true);

    const tools = freshGetFormTools(FORM);
    await tools
      .find((t: any) => t.name === 'feathery_fill_step')!
      .execute({
        values: {}
      });

    expect(windowDispatchSpy).toHaveBeenCalledTimes(1);
    expect(freshIsInteractionDetected()).toBe(true);
    windowDispatchSpy.mockRestore();
    delete freshInternalState[FORM];
  });
});
