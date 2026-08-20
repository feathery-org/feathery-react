import { validateElements } from '../validation';
import { fieldValues } from '../init';
import { getVisibleElements } from '../hideAndRepeats';

jest.mock('../init', () => ({
  initInfo: jest.fn().mockReturnValue({
    defaultErrors: { required: 'This is a required field' }
  }),
  fieldValues: {}
}));
jest.mock('../hideAndRepeats', () => ({ getVisibleElements: jest.fn() }));
jest.mock('../formHelperFunctions', () => ({ setFormElementError: jest.fn() }));

const stateField = {
  position: [2],
  servar: {
    id: 'servar-state',
    key: 'state',
    type: 'gmap_state',
    required: true,
    repeated: false,
    metadata: {}
  }
};
const countryField = {
  position: [3],
  servar: {
    id: 'servar-country',
    key: 'country',
    type: 'gmap_country',
    required: false,
    repeated: false,
    metadata: {}
  }
};
const step = { servar_fields: [stateField, countryField] };

const validate = () =>
  validateElements({
    step,
    visiblePositions: {},
    triggerErrors: false,
    errorType: 'html5',
    formRef: { current: null } as any,
    setInlineErrors: () => {}
  } as any);

describe('required state field with no states available', () => {
  beforeEach(() => {
    (getVisibleElements as jest.Mock).mockReturnValue([
      { element: stateField, repeat: null, last: false, type: 'servar_fields' }
    ]);
    Object.keys(fieldValues).forEach((k) => delete (fieldValues as any)[k]);
    (fieldValues as any).state = '';
  });

  // The field is disabled and has nothing to select, so requiring it would be
  // an error the user can never clear
  it('does not block submission when the country has no states', () => {
    (fieldValues as any).country = 'Netherlands';
    const { invalid, errors } = validate();
    expect(invalid).toBe(false);
    expect(errors.state).toBeUndefined();
  });

  it('still enforces required when the country does have states', () => {
    (fieldValues as any).country = 'Canada';
    const { invalid, errors } = validate();
    expect(invalid).toBe(true);
    expect(errors.state).toBe('This is a required field');
  });

  it('enforces required again once a state is chosen', () => {
    (fieldValues as any).country = 'Canada';
    (fieldValues as any).state = 'Ontario';
    expect(validate().invalid).toBe(false);
  });
});
