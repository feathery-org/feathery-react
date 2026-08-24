import internalState from '../../../utils/internalState';
import { dispatchClickElement } from '../clickElement';

// After row-qualified snapshot keys (`${id}[${index}]`), the click result must
// still return a repeated button's OWN error as buttonError (keyed to the
// clicked row) rather than leaking it into generic fieldErrors.
describe('dispatchClickElement repeated button error contract', () => {
  const formUuid = 'form-click-test';

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
  });

  it("returns the clicked row's error as buttonError, not a field error", async () => {
    makeState((state) => {
      state.inlineErrors = { btn: { byIndex: { 1: { message: 'Required' } } } };
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
    expect(result.buttonError).toBe('Required');
    expect(result.fieldErrors).toBeUndefined();
  });

  it("does not treat another row's error as the clicked button's error", async () => {
    makeState((state) => {
      state.inlineErrors = { btn: { byIndex: { 0: { message: 'Other row' } } } };
    });

    const result: any = await dispatchClickElement(formUuid, 'btn', 1);

    expect(result.ok).toBe(true);
    // Row 0 isn't the clicked row (1): it's a field error, not this click's buttonError.
    expect(result.buttonError).toBeUndefined();
    expect(result.fieldErrors).toEqual({ 'btn[0]': 'Other row' });
  });
});
