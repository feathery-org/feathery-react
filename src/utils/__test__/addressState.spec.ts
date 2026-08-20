import {
  getControllingCountryCode,
  stateFieldHasNoOptions
} from '../addressState';

const field = (type: string, key: string, id: string, position: number[]) => ({
  position,
  servar: { type, key, id, metadata: {} }
});

const state = field('gmap_state', 'state', 'servar-state', [2]);
const country = field('gmap_country', 'country', 'servar-country', [3]);
const activeStep = { servar_fields: [state, country] };

describe('getControllingCountryCode', () => {
  it('resolves a full country name to its ISO code', () => {
    expect(
      getControllingCountryCode(state, activeStep, {
        country: 'Netherlands'
      })
    ).toEqual('NL');
  });

  it('uses the stored value directly when the country saves abbreviations', () => {
    const abbrevCountry = field('gmap_country', 'country', 'servar-country', [
      3
    ]);
    abbrevCountry.servar.metadata = { store_abbreviation: true } as any;
    const step = { servar_fields: [state, abbrevCountry] };

    expect(getControllingCountryCode(state, step, { country: 'NL' })).toEqual(
      'NL'
    );
  });

  it('returns empty when there is no country field or no value', () => {
    expect(
      getControllingCountryCode(state, { servar_fields: [state] }, {})
    ).toEqual('');
    expect(
      getControllingCountryCode(state, activeStep, { country: '' })
    ).toEqual('');
  });
});

describe('stateFieldHasNoOptions', () => {
  it('is true for a country we ship no states for', () => {
    expect(
      stateFieldHasNoOptions(state, activeStep, { country: 'Netherlands' })
    ).toBe(true);
  });

  it('is false for a country we do ship states for', () => {
    expect(
      stateFieldHasNoOptions(state, activeStep, { country: 'United States' })
    ).toBe(false);
    expect(
      stateFieldHasNoOptions(state, activeStep, { country: 'Canada' })
    ).toBe(false);
  });

  // These get their options from the integration, so our state data says
  // nothing about whether the dropdown is empty
  it('is false for a salesforce-synced field', () => {
    const synced = field('gmap_state', 'state', 'servar-state', [2]);
    synced.servar.metadata = { salesforce_sync: 'Contact.State' } as any;
    expect(
      stateFieldHasNoOptions(
        synced,
        { servar_fields: [synced, country] },
        {
          country: 'Netherlands'
        }
      )
    ).toBe(false);
  });

  // Must match how DropdownField picks the country, or the field could hide
  // while it still has options to show
  it('falls back to the field default country, then us', () => {
    const noCountryStep = { servar_fields: [state] };
    expect(stateFieldHasNoOptions(state, noCountryStep, {})).toBe(false);

    const dutchDefault = field('gmap_state', 'state', 'servar-state', [2]);
    dutchDefault.servar.metadata = { default_country: 'nl' } as any;
    expect(
      stateFieldHasNoOptions(
        dutchDefault,
        { servar_fields: [dutchDefault] },
        {}
      )
    ).toBe(true);
  });
});

describe('repeating country and state fields', () => {
  const abbrevCountry = field('gmap_country', 'country', 'servar-country', [3]);
  abbrevCountry.servar.metadata = { store_abbreviation: true } as any;
  const step = { servar_fields: [state, abbrevCountry] };
  const values = { country: ['US', 'NL', 'CA'] };

  it('pairs each row with the country in the same row', () => {
    expect(getControllingCountryCode(state, step, values, 0)).toEqual('US');
    expect(getControllingCountryCode(state, step, values, 1)).toEqual('NL');
    expect(getControllingCountryCode(state, step, values, 2)).toEqual('CA');
  });

  it('hides only the rows whose country has no states', () => {
    expect(stateFieldHasNoOptions(state, step, values, 0)).toBe(false);
    expect(stateFieldHasNoOptions(state, step, values, 1)).toBe(true);
    expect(stateFieldHasNoOptions(state, step, values, 2)).toBe(false);
  });

  // A non-repeating state field alongside a repeating country has no row of
  // its own, and a row the user hasn't filled in yet should not read as blank
  it('falls back to the first entry with no index or an empty row', () => {
    expect(getControllingCountryCode(state, step, values)).toEqual('US');
    expect(
      getControllingCountryCode(state, step, { country: ['US', ''] }, 1)
    ).toEqual('US');
  });
});
