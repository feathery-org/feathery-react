import { getVisiblePositions } from '../hideAndRepeats';
import { fieldValues } from '../init';

const stateField = (metadata: Record<string, any>) => ({
  position: [1],
  hide_ifs: [],
  show_logic: false,
  servar: { type: 'gmap_state', key: 'state', id: 'servar-state', metadata }
});

const countryField = {
  position: [0],
  hide_ifs: [],
  show_logic: false,
  servar: {
    type: 'gmap_country',
    key: 'country',
    id: 'servar-country',
    metadata: {}
  }
};

const buildStep = (state: any) => ({
  id: 'step-1',
  subgrids: [{ position: [], hide_ifs: [], show_logic: false }],
  texts: [],
  buttons: [],
  servar_fields: [countryField, state],
  progress_bars: [],
  images: [],
  videos: [],
  tables: [],
  tabs: []
});

const stateVisible = (step: any) =>
  getVisiblePositions(step, 'test-form')['1'][0];

describe('hiding a state field without options', () => {
  afterEach(() => {
    delete fieldValues.country;
  });

  it('leaves the field visible when the toggle is explicitly off', () => {
    const step = buildStep(stateField({ hide_without_states: false }));
    fieldValues.country = 'Netherlands';
    expect(stateVisible(step)).toBe(true);
  });

  // Fields built before the setting existed have no key at all, and draft step
  // blobs can carry a stale servar snapshot - both must still get the behavior
  it('applies when the setting is absent', () => {
    const step = buildStep(stateField({}));
    fieldValues.country = 'Netherlands';
    expect(stateVisible(step)).toBe(false);
    fieldValues.country = 'United States';
    expect(stateVisible(step)).toBe(true);
  });

  // The scenario Aspire hit: no logic rule involved, just the country value
  it('hides and reshows as the country value changes', () => {
    const step = buildStep(stateField({}));

    fieldValues.country = 'United States';
    expect(stateVisible(step)).toBe(true);

    fieldValues.country = 'Netherlands';
    expect(stateVisible(step)).toBe(false);

    // An address autocomplete writing the country back is just another value
    // change, so the field returns on its own
    fieldValues.country = 'United States';
    expect(stateVisible(step)).toBe(true);
  });

  it('falls back to the default country before one is picked', () => {
    expect(stateVisible(buildStep(stateField({ default_country: 'nl' })))).toBe(
      false
    );
    expect(stateVisible(buildStep(stateField({ default_country: 'us' })))).toBe(
      true
    );
  });
});
