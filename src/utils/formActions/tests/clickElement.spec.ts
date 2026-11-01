import internalState from '../../internalState';
import { initState } from '../../init';
import { clickElement } from '../clickElement';
import * as formActionUtils from '../utils';

// The real first-interaction release needs a configured client, covered in utils.spec
let markInteraction: jest.SpyInstance;
beforeEach(() => {
  markInteraction = jest
    .spyOn(formActionUtils, 'markInteraction')
    .mockImplementation(() => {});
});

afterEach(() => {
  markInteraction.mockRestore();
});

// A repeated button's own error comes back as buttonError for the clicked row, even though it is published late
describe('clickElement repeated button error contract', () => {
  const formUuid = 'form-click-test';

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
      formActions: { buttonOnClick: jest.fn(async () => onClick(state)) }
    };
    (internalState as any)[formUuid] = state;
    return state;
  };

  afterEach(() => {
    delete (internalState as any)[formUuid];
    jest.useRealTimers();
  });

  it('reports completion only after the native click acknowledges it', async () => {
    const formKey = 'completion-test';
    initState.formSessions[formKey] = { form_completed: false };
    try {
      const state = makeState(() => {});
      state.client = { formKey };
      expect(await clickElement(formUuid, 'btn', 0)).not.toHaveProperty(
        'formCompleted'
      );
      state.formActions.buttonOnClick = async () => {
        await Promise.resolve();
        initState.formSessions[formKey].form_completed = true;
      };
      expect(await clickElement(formUuid, 'btn', 0)).toMatchObject({
        ok: true,
        navigated: null,
        formCompleted: true
      });
    } finally {
      delete initState.formSessions[formKey];
    }
  });

  it('reports a native button failure without relying on inline or HTML5 controls', async () => {
    const state = makeState(() => {});
    state.formSettings.errorType = 'html5';
    state.formActions.buttonOnClick = async () => ({
      buttonError: 'Email delivery failed'
    });
    expect(await clickElement(formUuid, 'btn', 0)).toMatchObject({
      ok: true,
      buttonError: 'Email delivery failed'
    });
  });

  it("awaits the async publication and returns the clicked row's error as buttonError", async () => {
    makeState((state) => {
      publishLater(state, { btn: { byIndex: { 1: { message: 'Required' } } } });
    });

    const result: any = await clickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
    expect(result.buttonError).toBe('Required');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('still settles when the publication is slower', async () => {
    makeState((state) => {
      publishLater(state, { btn: { byIndex: { 0: { message: 'Slow' } } } }, 50);
    });

    const result: any = await clickElement(formUuid, 'btn', 0);

    expect(result.buttonError).toBe('Slow');
  });

  it("does not treat another row's error as the clicked button's error", async () => {
    makeState((state) => {
      publishLater(state, {
        btn: { byIndex: { 0: { message: 'Other row' } } }
      });
    });

    const result: any = await clickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
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

    const result: any = await clickElement(formUuid, 'btn', 1);

    expect(result.buttonError).toBe('Fix the row');
    expect(result.fieldErrors).toEqual([
      { key: 'name', repeatIndex: 1, message: 'Required' }
    ]);
  });
});

describe('clickElement text links', () => {
  const formUuid = 'form-click-text-test';

  afterEach(() => {
    delete (internalState as any)[formUuid];
  });

  it('refuses text whose words link to different steps', async () => {
    const runElementActions = jest.fn();
    (internalState as any)[formUuid] = {
      currentStep: {
        buttons: [],
        texts: [
          {
            id: 'txt',
            position: [0],
            properties: { actions: [{ type: 'next' }] }
          }
        ],
        subgrids: [],
        servar_fields: [],
        next_conditions: [
          {
            element_type: 'text',
            element_id: 'txt',
            metadata: { start: 0, end: 4 }
          }
        ]
      },
      visiblePositions: { '0': [true] },
      formSettings: {},
      inlineErrors: {},
      formActions: { runElementActions }
    };

    const result: any = await clickElement(formUuid, 'txt');

    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(runElementActions).not.toHaveBeenCalled();
  });
});
